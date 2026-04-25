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
import { assertTripleSupported } from './handlers/npm-platform.js';
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
  // #216: bare filename of a consumer-supplied `workflow_call` workflow
  // to dispatch for this package's build, e.g. "publish-python.yml". Set
  // from the package's config; empty for packages that use piot's default
  // in-line build steps. The consumer's release.yml is expected to
  // branch on this field — GitHub Actions doesn't support dynamic
  // `uses:`, so piot can't auto-wire the composition.
  build_workflow?: string;
  // #217: per-target bundle-a-Rust-CLI-into-the-wheel recipe. Set on
  // maturin per-target rows when `[package.bundle_cli]` is declared;
  // NOT set on the sdist row (source-only, no cross-compile happens).
  // Scaffolded build job branches on this to emit the cargo build +
  // stage step before maturin.
  bundle_cli?: {
    bin: string;
    stage_to: string;
    crate_path: string;
  };
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
    const pkgRows = rowsForPackage(p, version);
    // #216: stamp `build_workflow` onto every row for this package so
    // the consumer's release.yml can branch per-row instead of having
    // to look up the package by name.
    const buildWorkflow = (p as { build_workflow?: string }).build_workflow;
    if (buildWorkflow !== undefined) {
      for (const r of pkgRows) r.build_workflow = buildWorkflow;
    }
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

function rowsForPackage(pkg: Package, version: string): MatrixRow[] {
  // #230: actions/upload-artifact@v4 forbids `/` in artifact names, so
  // any package name containing a slash (the polyglot-monorepo
  // grouping shape, e.g. `py/foo`, `js/bar`) needs to be encoded
  // before being used as an artifact-name component. Encoding here +
  // a config-load rule rejecting the encoding sequence in `pkg.name`
  // makes the round-trip unambiguous. Read sites under publish/
  // doctor/preflight/completeness consume `artifact_name` verbatim
  // and need no changes.
  const safe = sanitizeArtifactName(pkg.name);
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
          artifact_path: `${pkg.path}/target/package`,
          path: pkg.path,
        },
      ];

    case 'pypi': {
      const build = (pkg as { build?: string }).build;
      const targets = (pkg as { targets?: TargetEntry[] }).targets ?? [];
      const bundleCli = (pkg as { bundle_cli?: MatrixRow['bundle_cli'] }).bundle_cli;
      const out: MatrixRow[] = [];
      if (build === 'maturin' && targets.length > 0) {
        for (const entry of targets) {
          const { triple, runner } = normalizeTarget(entry);
          const row: MatrixRow = {
            name: pkg.name,
            kind: 'pypi',
            version,
            target: triple,
            runs_on: runner ?? defaultRunsOn(triple),
            artifact_name: `${safe}-wheel-${triple}`,
            artifact_path: `${pkg.path}/dist`,
            path: pkg.path,
            build,
          };
          // #217: per-target wheels carry bundle_cli; sdist does not.
          if (bundleCli !== undefined) row.bundle_cli = bundleCli;
          out.push(row);
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
        artifact_path: `${pkg.path}/dist`,
        path: pkg.path,
        ...(build !== undefined ? { build } : {}),
      });
      return out;
    }

    case 'npm': {
      const build = (pkg as { build?: string }).build;
      const targets = (pkg as { targets?: TargetEntry[] }).targets ?? [];
      if (build === 'napi' || build === 'bundled-cli') {
        // Plan-time guard: bail before a CI matrix runs on an unmapped
        // triple. Handler-time validation remains as belt-and-suspenders.
        // Issue #170 follow-up.
        for (const entry of targets) {
          assertTripleSupported(normalizeTarget(entry).triple, pkg.name);
        }
        const out: MatrixRow[] = [];
        for (const entry of targets) {
          const { triple, runner } = normalizeTarget(entry);
          out.push({
            name: pkg.name,
            kind: 'npm',
            version,
            target: triple,
            runs_on: runner ?? defaultRunsOn(triple),
            artifact_name: `${safe}-${triple}`,
            artifact_path: `${pkg.path}/build/${triple}`,
            path: pkg.path,
            build,
          });
        }
        // Plus the main package row.
        out.push({
          name: pkg.name,
          kind: 'npm',
          version,
          target: 'main',
          runs_on: 'ubuntu-latest',
          artifact_name: `${safe}-main`,
          artifact_path: pkg.path,
          path: pkg.path,
          build,
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
          artifact_path: pkg.path,
          path: pkg.path,
          ...(build !== undefined ? { build } : {}),
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
function defaultRunsOn(target: string): string {
  if (target.includes('apple-darwin') || target.includes('darwin') || target.includes('mac')) {
    return 'macos-latest';
  }
  if (target.includes('windows') || target.includes('win32') || target.includes('msvc')) {
    return 'windows-latest';
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
