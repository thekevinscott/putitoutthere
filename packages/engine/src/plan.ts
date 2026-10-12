/**
 * `putitoutthere plan` — the planner (#21, plan.md §12.4). Composes config,
 * trailer, cascade, version and git into the matrix-row array the GHA `build`
 * job consumes. Deterministic for the same inputs, so golden-file CI checks
 * have something stable to compare.
 */

import { join } from 'node:path';

import { computeCascade } from './cascade.js';
import { loadConfig, type Package } from './config.js';
import { commitBody, commitParents, diffNames, headCommit, lastTag } from './git.js';
import { rowsForPackage } from './rows-for-package.js';
import type { Bump, Kind } from './types.js';
import { parseTrailer, type Trailer } from './trailer.js';
import { parseReleasePackages, type ReleasePackagesEntry } from './release-packages.js';
import { bump as bumpVersion, firstVersion, formatSemver } from './version.js';

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
  // #217 (pypi) / #298 (npm): per-target bundle-a-Rust-CLI recipe. Set on
  // maturin per-target wheel rows and npm per-target bundled-cli rows, never on
  // the sdist row, the npm main row, or napi rows. `stage_to` is pypi-only —
  // npm staging is fully determined by `artifact_path`, so it stays unset.
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
  // #387 (npm): the Rust (rustup/cargo) target triple for this row's
  // bundled-cli cross-compile. npm `target` is an napi-rs short-form
  // triple (`linux-x64-gnu`) that `rustup target add` / `cargo build
  // --target` cannot consume; `plan` resolves it once via `toRustTriple`
  // so the workflow reads `matrix.rust_target` instead of re-deriving the
  // mapping in shell. Set ONLY on npm bundled-cli per-target rows. Absent
  // on napi rows, the npm main row, and pypi/crates rows (pypi `targets`
  // are already Rust triples — the workflow uses `matrix.target` there).
  rust_target?: string;
  // #610 (pypi): linux wheel platform-tag baseline, forwarded verbatim
  // to maturin-action's `manylinux` input so the wheel builds inside the
  // matching manylinux/musllinux container instead of on the host (whose
  // glibc would tag the wheel, e.g. manylinux_2_39 on ubuntu-24.04 —
  // thekevinscott/dirsql#818). Set ONLY on maturin per-target linux
  // wheel rows whose libc family matches the value (manylinux* ↔ -gnu
  // triples, musllinux* ↔ -musl triples). Absent everywhere else, so an
  // empty `matrix.manylinux` in the workflow preserves today's
  // host-build behavior exactly.
  manylinux?: string;
}

export interface PlanOptions {
  cwd: string;
  configPath?: string;   // defaults to `${cwd}/putitoutthere.toml`
  /**
   * Manual-release spec (the reusable workflow's `release_packages`
   * input). When set, change detection is bypassed entirely and the
   * matrix covers exactly the named packages — the re-release path for
   * consumers with no new commits since their last tag.
   */
  releasePackages?: string | undefined;
}

export async function plan(opts: PlanOptions): Promise<MatrixRow[]> {
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');
  const config = await loadConfig(cfgPath);

  // Manual release: an explicit package list short-circuits change
  // detection. `release_packages` is the override for re-releasing
  // packages that have no new commits (e.g. after a putitoutthere bug
  // fix). The named packages — and only those — are planned.
  const manual = parseReleasePackages(opts.releasePackages);
  if (manual !== null) {
    return planManual(config.packages, manual, cwd);
  }

  // What changed since the last release per package?
  const head = await headCommit({ cwd });
  const trailer = await resolveTrailer(head, cwd);

  if (trailer?.bump === 'skip') {
    return [];
  }

  // Compute cascade. For each package with a last tag, diff against
  // that tag. Packages without a last tag are first-release: force-
  // cascade without globbing (avoids walking the working tree).
  //
  // Seed detection is per-package: a package only cascades on its own
  // diff, never on another package's pre-tag history. See #126.
  const { changesByPackage, firstRelease } = await collectChanges(config.packages, cwd);
  const cascaded = new Set(
    computeCascade(config.packages, changesByPackage).map((p) => p.name),
  );
  for (const name of firstRelease) {cascaded.add(name);}

  // Trailer can additionally force-include packages by name.
  const forced = new Set(trailer?.packages ?? []);
  for (const name of forced) {cascaded.add(name);}

  if (cascaded.size === 0) {return [];}

  const rows: MatrixRow[] = [];
  for (const p of config.packages) {
    if (!cascaded.has(p.name)) {continue;}
    const version = await nextVersion(p, trailer?.bump, cwd, forced);
    const pkgRows = await rowsForPackage(p, version, cwd);
    rows.push(...pkgRows);
  }
  return rows;
}

/* ----------------------------- internals ----------------------------- */

/**
 * Manual-release planner. Emits a matrix for exactly the packages named
 * in the `release_packages` spec — no change detection, no cascade.
 * Each named package is versioned per its entry: an explicit semver is
 * used verbatim, a bump keyword bumps the last tag (or first_version
 * when the package has no tag yet).
 */
async function planManual(
  packages: readonly Package[],
  manual: ReadonlyMap<string, ReleasePackagesEntry>,
  cwd: string,
): Promise<MatrixRow[]> {
  const known = new Set(packages.map((p) => p.name));
  for (const name of manual.keys()) {
    if (!known.has(name)) {
      throw new Error(
        `release-packages: "${name}" is not declared in putitoutthere.toml`,
      );
    }
  }
  // Iterate config order so the matrix shape matches the change-
  // detected path for the same package set.
  const rows: MatrixRow[] = [];
  for (const p of packages) {
    const entry = manual.get(p.name);
    if (entry === undefined) {continue;}
    rows.push(...(await rowsForPackage(p, await manualVersion(p, entry, cwd), cwd)));
  }
  return rows;
}

async function manualVersion(
  pkg: Package,
  entry: ReleasePackagesEntry,
  cwd: string,
): Promise<string> {
  // Explicit semver is used as-is. It is intentionally NOT compared
  // against the last tag: re-releasing the same version is valid when
  // the prior publish failed before reaching the registry, and the
  // publish-phase `isPublished` check is the right place to refuse a
  // genuine collision.
  if (entry.version !== undefined) {return entry.version;}

  // A bump keyword bumps the last tag, or first_version when the named
  // package has never been released. `lastTag` hands back the parsed
  // version, so there's nothing left to re-parse.
  const last = await lastTag(pkg.name, pkg.tag_format, { cwd });
  if (last === null) {return firstVersion(pkg);}
  return bumpVersion(formatSemver(last.version), entry.bump!);
}

async function collectChanges(
  packages: readonly Package[],
  cwd: string,
): Promise<{
  changesByPackage: ReadonlyMap<string, ReadonlySet<string>>;
  firstRelease: ReadonlySet<string>;
}> {
  const changesByPackage = new Map<string, ReadonlySet<string>>();
  const firstRelease = new Set<string>();
  // Packages in a polyglot repo typically tag together, so many of them
  // point at the same `last_tag-v*` SHA. Memoize `git diff --name-only
  // <tag>..HEAD` by tag so we spawn one `git diff` per unique tag
  // instead of one per package (#140).
  const diffCache = new Map<string, ReadonlySet<string>>();
  for (const p of packages) {
    const last = await lastTag(p.name, p.tag_format, { cwd });
    if (last === null) {
      firstRelease.add(p.name);
      continue;
    }
    const tag = last.tag;
    let diff = diffCache.get(tag);
    if (diff === undefined) {
      diff = new Set(await diffNames(tag, 'HEAD', { cwd }));
      diffCache.set(tag, diff);
    }
    changesByPackage.set(p.name, diff);
  }
  return { changesByPackage, firstRelease };
}

async function nextVersion(
  pkg: Package,
  trailerBump: Bump | 'skip' | undefined,
  cwd: string,
  trailerPackages: ReadonlySet<string>,
): Promise<string> {
  const last = await lastTag(pkg.name, pkg.tag_format, { cwd });
  if (last === null) {
    return firstVersion(pkg);
  }
  const lastVersion = formatSemver(last.version);

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

/**
 * Read the release trailer starting from `head`. If `head` carries no
 * trailer but is a merge commit, fall back to the non-first-parent — by
 * GitHub convention that's the feature branch tip whose commit message
 * the operator actually wrote the trailer into. Without this fallback,
 * merge-commit merges silently strand every release.
 */
async function resolveTrailer(head: string, cwd: string): Promise<Trailer | null> {
  const direct = parseTrailer(await commitBody(head, { cwd }));
  if (direct) {return direct;}
  const parents = await commitParents(head, { cwd });
  if (parents.length < 2) {return null;}
  for (let i = 1; i < parents.length; i++) {
    const parentSha = parents[i]!;
    const t = parseTrailer(await commitBody(parentSha, { cwd }));
    if (t) {return t;}
  }
  return null;
}
