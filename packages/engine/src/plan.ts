/**
 * `putitoutthere plan` — the planner (#21, plan.md §12.4). Composes config,
 * trailer, cascade, version and git into the matrix-row array the GHA `build`
 * job consumes. Deterministic for the same inputs, so golden-file CI checks
 * have something stable to compare.
 */

import { join } from 'node:path';

import { computeCascade } from './cascade.js';
import { collectChanges } from './collect-changes.js';
import { loadConfig } from './config.js';
import { headCommit } from './git.js';
import { nextVersion } from './next-version.js';
import { planManual } from './plan-manual.js';
import { parseReleasePackages } from './release-packages.js';
import { resolveTrailer } from './resolve-trailer.js';
import { rowsForPackage } from './rows-for-package.js';
import type { Kind } from './types.js';

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

  const rows: MatrixRow[] = [];
  for (const p of config.packages) {
    if (!cascaded.has(p.name)) {continue;}
    const version = await nextVersion(p, trailer?.bump, cwd, forced);
    const pkgRows = await rowsForPackage(p, version, cwd);
    rows.push(...pkgRows);
  }
  return rows;
}
