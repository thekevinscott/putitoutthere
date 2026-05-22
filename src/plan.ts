/**
 * `putitoutthere plan` — the planner.
 *
 * Composes config, trailer, cascade, version, git into the matrix-row
 * array consumed by the GHA `build` job. Per plan.md §12.4. Pure
 * function over (config + git state) → matrix; deterministic for the
 * same inputs so CI golden-file checks have something to compare.
 *
 * Issue #21.
 */

import { join } from 'node:path';

import { computeCascade } from './cascade.js';
import { loadConfig, sanitizeArtifactName, type Package } from './config.js';
import { commitBody, commitParents, diffNames, headCommit, lastTag } from './git.js';
import {
  assertTripleSupported,
  normalizeBuild,
  platformArtifactName,
  type NpmBuildField,
} from './handlers/npm-platform.js';
import { resolvePythonVersions } from './python-versions.js';
import { parseTagVersion } from './tag-template.js';
import { normalizeTarget, type Bump, type Kind, type TargetEntry } from './types.js';
import { parseTrailer, type Trailer } from './trailer.js';
import { bump as bumpVersion, firstVersion } from './version.js';

export interface MatrixRow {
  name: string;
  kind: Kind;
  version: string;
  target: string;        // 'noarch' | 'sdist' | 'main' | <triple>
  runs_on: string;
  artifact_name: string;
  artifact_path: string;
  path: string;          // package working dir
  build?: string;        // handler-specific build mode
  // #217 (pypi) / #298 (npm): per-target bundle-a-Rust-CLI recipe.
  // Set on maturin per-target wheel rows AND on npm per-target
  // bundled-cli rows when `[package.bundle_cli]` is declared on the
  // package. NOT set on the sdist row (pypi, source-only), the main
  // row (npm, top-level launcher only), or napi rows in a multi-mode
  // npm package. The scaffolded build job branches on this to emit
  // the cargo build + stage step before the build tool runs.
  //
  // `stage_to` is pypi-only — npm staging target is fully determined
  // by `artifact_path` and so is left unset on npm rows. The optional
  // field carries the union of both shapes; pypi rows always supply
  // it, npm rows always omit it.
  bundle_cli?: {
    bin: string;
    stage_to?: string;
    crate_path: string;
    features: string[];
    no_default_features: boolean;
  };
  // #369 (pypi): the CPython version this row's build targets. Set on
  // every pypi row — per-version on maturin per-target wheel rows
  // (the matrix fans across the resolved version set), and the newest
  // resolved version on the version-agnostic sdist / hatch wheel-any
  // rows (which still need an interpreter to run the build). Absent on
  // crates / npm rows. `_matrix.yml` feeds it to `actions/setup-python`
  // and, for maturin, to the build's `--interpreter` selection.
  python_version?: string;
}

export interface PlanOptions {
  cwd: string;
  configPath?: string;   // defaults to `${cwd}/putitoutthere.toml`
}

export function plan(opts: PlanOptions): Promise<MatrixRow[]> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const config = loadConfig(cfgPath);

  // What changed since the last release per package?
  const head = headCommit({ cwd });
  const trailer = resolveTrailer(head, cwd);

  if (trailer?.bump === 'skip') {
    return Promise.resolve([]);
  }

  // Compute cascade. For each package with a last tag, diff against
  // that tag. Packages without a last tag are first-release: force-
  // cascade without globbing (avoids walking the working tree).
  //
  // Seed detection is per-package: a package only cascades on its own
  // diff, never on another package's pre-tag history. See #126.
  const { changesByPackage, firstRelease } = collectChanges(config.packages, cwd);
  const cascaded = new Set(
    computeCascade(config.packages, changesByPackage).map((p) => p.name),
  );
  for (const name of firstRelease) cascaded.add(name);

  // Trailer can additionally force-include packages by name.
  const forced = new Set(trailer?.packages ?? []);
  for (const name of forced) cascaded.add(name);

  if (cascaded.size === 0) return Promise.resolve([]);

  const rows: MatrixRow[] = [];
  for (const p of config.packages) {
    if (!cascaded.has(p.name)) continue;
    const version = nextVersion(p, trailer?.bump, cwd, forced);
    const pkgRows = rowsForPackage(p, version, cwd);
    rows.push(...pkgRows);
  }
  return Promise.resolve(rows);
}

/* ----------------------------- internals ----------------------------- */

function collectChanges(
  packages: readonly Package[],
  cwd: string,
): {
  changesByPackage: ReadonlyMap<string, ReadonlySet<string>>;
  firstRelease: ReadonlySet<string>;
} {
  const changesByPackage = new Map<string, ReadonlySet<string>>();
  const firstRelease = new Set<string>();
  // Packages in a polyglot repo typically tag together, so many of them
  // point at the same `last_tag-v*` SHA. Memoize `git diff --name-only
  // <tag>..HEAD` by tag so we spawn one `git diff` per unique tag
  // instead of one per package (#140).
  const diffCache = new Map<string, ReadonlySet<string>>();
  for (const p of packages) {
    const tag = lastTag(p.name, p.tag_format, { cwd });
    if (tag === null) {
      firstRelease.add(p.name);
      continue;
    }
    let diff = diffCache.get(tag);
    if (diff === undefined) {
      diff = new Set(diffNames(tag, 'HEAD', { cwd }));
      diffCache.set(tag, diff);
    }
    changesByPackage.set(p.name, diff);
  }
  return { changesByPackage, firstRelease };
}

function nextVersion(
  pkg: Package,
  trailerBump: Bump | 'skip' | undefined,
  cwd: string,
  trailerPackages: ReadonlySet<string>,
): string {
  const tag = lastTag(pkg.name, pkg.tag_format, { cwd });
  if (tag === null) {
    return firstVersion(pkg);
  }
  /* v8 ignore next -- lastTag only returns tags that parseTagVersion already accepted */
  const lastVersion = parseTagVersion(pkg.tag_format, pkg.name, tag) ?? firstVersion(pkg);

  // Trailer bump applies to every cascaded package, OR specifically to
  // packages listed in [trailer.packages]. If the trailer scoped the
  // list, only listed packages get the trailer's bump; unlisted
  // cascaded packages still go at default patch.
  const wantsBump =
    trailerBump !== undefined &&
    trailerBump !== 'skip' &&
    (trailerPackages.size === 0 || trailerPackages.has(pkg.name));

  const bumpType: Bump = wantsBump ? trailerBump : 'patch';
  return bumpVersion(lastVersion, bumpType);
}

function rowsForPackage(pkg: Package, version: string, cwd: string): MatrixRow[] {
  // #230: actions/upload-artifact@v4 forbids `/` in artifact names, so
  // any package name containing a slash (the polyglot-monorepo
  // grouping shape, e.g. `py/foo`, `js/bar`) needs to be encoded
  // before being used as an artifact-name component. Encoding here +
  // a config-load rule rejecting the encoding sequence in `pkg.name`
  // makes the round-trip unambiguous. Read sites under publish/
  // doctor/preflight/completeness consume `artifact_name` verbatim
  // and need no changes.
  //
  // #244: actions/upload-artifact@v4 also rejects paths starting with
  // `./` or equal to `.`, which is what `${pkg.path}/dist` produces
  // when pkg.path is `.` (single-package-at-root shape). Normalize
  // paths through `joinPath` so consumers with `path = "."` aren't
  // tripped by the upload step.
  const safe = sanitizeArtifactName(pkg.name);
  const at = (subdir: string): string => joinPath(pkg.path, subdir);
  switch (pkg.kind) {
    case 'crates':
      return [
        {
          name: pkg.name,
          kind: 'crates',
          version,
          target: 'noarch',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-crate`,
          artifact_path: at('target/package'),
          path: pkg.path,
        },
      ];

    case 'pypi': {
      const build = (pkg as { build?: string }).build;
      const targets = (pkg as { targets?: TargetEntry[] }).targets ?? [];
      const bundleCli = (pkg as { bundle_cli?: MatrixRow['bundle_cli'] }).bundle_cli;
      // #369: every wheel is built for a specific CPython version.
      // Resolve the set — config `python_versions` override, else
      // `requires-python` inference, else a single default — and fan
      // the maturin per-target wheel rows across it.
      const pyVersions = resolvePythonVersions(pkg, cwd);
      const multiPy = pyVersions.length > 1;
      // The sdist and pure-Python hatch wheel are version-agnostic but
      // still need an interpreter to run the build; use the newest
      // resolved version.
      const buildPython = pyVersions[pyVersions.length - 1]!;
      const out: MatrixRow[] = [];
      if (build === 'maturin' && targets.length > 0) {
        for (const entry of targets) {
          const { triple, runner } = normalizeTarget(entry);
          for (const py of pyVersions) {
            const row: MatrixRow = {
              name: pkg.name,
              kind: 'pypi',
              version,
              target: triple,
              runs_on: runner ?? defaultRunsOn(triple),
              // A single planned version keeps the historical
              // unsuffixed artifact name; a multi-version fan adds a
              // `-py<ver>` slot so per-version wheels for the same
              // triple don't collide at upload.
              artifact_name: multiPy
                ? `${safe}-wheel-${triple}-py${py}`
                : `${safe}-wheel-${triple}`,
              artifact_path: at('dist'),
              path: pkg.path,
              build,
              python_version: py,
            };
            // #217: per-target wheels carry bundle_cli; sdist does not.
            if (bundleCli !== undefined) row.bundle_cli = bundleCli;
            out.push(row);
          }
        }
      }
      // Always emit an sdist row for pypi. Source-only — no staged
      // binary, no bundle_cli field.
      out.push({
        name: pkg.name,
        kind: 'pypi',
        version,
        target: 'sdist',
        runs_on: 'ubuntu-latest',
        artifact_name: `${safe}-sdist`,
        artifact_path: at('dist'),
        path: pkg.path,
        python_version: buildPython,
        ...(build !== undefined ? { build } : {}),
      });
      // #324: pure-Python hatch packages also emit a `wheel-any` row.
      // `pypa/build`'s default on a pure-Python tree produces both an
      // sdist and an any-platform wheel; sdist-only meant downstream
      // `pip install` / `uvx ...` had to provision hatchling and run
      // `python -m build` on a cold cache. Scoped to hatch per the
      // issue — setuptools stays sdist-only, maturin keeps its
      // per-target wheel rows.
      if (build === 'hatch') {
        out.push({
          name: pkg.name,
          kind: 'pypi',
          version,
          target: 'any',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-wheel-any`,
          artifact_path: at('dist'),
          path: pkg.path,
          build,
          python_version: buildPython,
        });
      }
      return out;
    }

    case 'npm': {
      const rawBuild = (pkg as { build?: NpmBuildField }).build;
      const buildEntries = normalizeBuild(rawBuild);
      const targets = (pkg as { targets?: TargetEntry[] }).targets ?? [];
      // #298: bundle_cli attaches to bundled-cli per-target rows only.
      // Schema guarantees the block is only present when at least one
      // bundled-cli entry exists in `build` AND `targets` is non-empty.
      const bundleCli = (pkg as { bundle_cli?: MatrixRow['bundle_cli'] }).bundle_cli;
      if (buildEntries.length > 0) {
        // Plan-time guard: bail before a CI matrix runs on an unmapped
        // triple. Handler-time validation remains as belt-and-suspenders.
        // Issue #170 follow-up.
        for (const tEntry of targets) {
          assertTripleSupported(normalizeTarget(tEntry).triple, pkg.name);
        }
        const isMulti = buildEntries.length > 1;
        const out: MatrixRow[] = [];
        for (const bEntry of buildEntries) {
          for (const tEntry of targets) {
            const { triple, runner } = normalizeTarget(tEntry);
            // #dirsql: multi-mode rows carry a mode infix in both the
            // artifact-name and artifact-path so napi `.node` files and
            // bundled-cli binaries don't collide on the build side.
            // Single-mode shape preserved byte-for-byte.
            const artifactName = platformArtifactName(pkg.name, bEntry.mode, triple, isMulti);
            const artifactPath = isMulti
              ? at(`build/${bEntry.mode}-${triple}`)
              : at(`build/${triple}`);
            const row: MatrixRow = {
              name: pkg.name,
              kind: 'npm',
              version,
              target: triple,
              runs_on: runner ?? defaultRunsOn(triple),
              artifact_name: artifactName,
              artifact_path: artifactPath,
              path: pkg.path,
              build: bEntry.mode,
            };
            // #298: bundled-cli per-target rows carry the cross-compile
            // metadata. napi rows in a multi-mode package don't — napi
            // has its own toolchain and stages `.node` files differently.
            // The main row also doesn't carry bundle_cli (no per-target
            // binary to compile at the top-level).
            if (bundleCli !== undefined && bEntry.mode === 'bundled-cli') {
              row.bundle_cli = bundleCli;
            }
            out.push(row);
          }
        }
        // Plus the main package row. The main row's `build` is informational
        // (no per-target compile happens for it); we set it to the first
        // entry's mode so length-1 array forms match the string-form shape.
        out.push({
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'main',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-main`,
          artifact_path: at('package.json'),
          path: pkg.path,
          build: buildEntries[0]!.mode,
        });
        return out;
      }
      // Vanilla mode: single noarch row.
      return [
        {
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'noarch',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-pkg`,
          artifact_path: at('package.json'),
          path: pkg.path,
        },
      ];
    }
  }
}

/**
 * Per-target default GHA runner. Native runners where available, else
 * cross-compile on ubuntu. Plan §12.3 calls these out as "opinionated
 * defaults; user can override".
 */
/**
 * Join `base` + `subdir` into a path that `actions/upload-artifact@v4`
 * accepts. Special-cases `base === '.'` to avoid the `./subdir` /
 * leading-`./` shape the action rejects (#244).
 */
function joinPath(base: string, subdir: string): string {
  return base === '.' ? subdir : `${base}/${subdir}`;
}

function defaultRunsOn(target: string): string {
  if (target.includes('apple-darwin') || target.includes('darwin') || target.includes('mac')) {
    return 'macos-latest';
  }
  if (target.includes('windows') || target.includes('win32') || target.includes('msvc')) {
    // Pinned: GitHub is migrating windows-latest → windows-2025-vs2026
    // between 2026-06-08 and 2026-06-15. Tracking the floating label would
    // silently move every consumer's Windows release runs onto VS2026 on
    // the cutover. Consumers that want a different image opt in via the
    // per-target `{ triple, runner }` override. See issue #354.
    return 'windows-2022';
  }
  if (target.includes('aarch64-unknown-linux') || target.includes('aarch64-linux')) {
    // Native arm runners are free for public repos.
    return 'ubuntu-24.04-arm';
  }
  return 'ubuntu-latest';
}

/**
 * Read the release trailer starting from `head`. If `head` carries no
 * trailer but is a merge commit, fall back to the non-first-parent — by
 * GitHub convention that's the feature branch tip whose commit message
 * the operator actually wrote the trailer into. Without this fallback,
 * merge-commit merges silently strand every release.
 */
function resolveTrailer(head: string, cwd: string): Trailer | null {
  const direct = parseTrailer(commitBody(head, { cwd }));
  if (direct) return direct;
  const parents = commitParents(head, { cwd });
  if (parents.length < 2) return null;
  for (let i = 1; i < parents.length; i++) {
    const parentSha = parents[i]!;
    const t = parseTrailer(commitBody(parentSha, { cwd }));
    if (t) return t;
  }
  return null;
}
