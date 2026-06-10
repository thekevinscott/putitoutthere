/**
 * Pre-build version bump for the npm `bundled-cli` path. #366.
 *
 * `cargo build` bakes `CARGO_PKG_VERSION` into the compiled binary at
 * build time, sourced from `[package].version` in the crate's
 * `Cargo.toml`. There is no env override. The npm `bundled-cli` path in
 * `_matrix.yml` cross-compiles a Rust CLI and ships it inside the
 * per-platform package; without rewriting the crate manifest first, the
 * binary reports whatever literal sits on disk — diverging from the
 * planned release version (a `@scope/cli-<triple>@0.3.5` package whose
 * `--version` says `0.2.7`).
 *
 * The maturin/pypi path already solves the equivalent problem with
 * `write-version` (#276), but that command is tied to maturin's
 * dynamic-version contract — it requires a `pyproject.toml` declaring
 * `dynamic = ["version"]`. The npm bundled-cli crate has only a
 * `Cargo.toml`, so it needs a manifest-direct bump with no pyproject
 * gate. This is that command.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { replaceCargoVersion } from './handlers/crates.js';

/**
 * Rewrite `[package].version` in the crate at `crateDir` to `version`
 * and return the list of absolute paths that were modified.
 *
 * Errors if `Cargo.toml` is missing or carries no `[package].version`
 * field — fail loud rather than cross-compile an under-versioned
 * binary. I/O uses `readFileSync` with `try` / `catch (ENOENT)` rather
 * than an `existsSync` precheck to avoid the TOCTOU race CodeQL flags,
 * mirroring `writeVersionForBuild`. Non-ENOENT read failures surface
 * unmodified.
 */
export function writeCrateVersionForBuild(crateDir: string, version: string): string[] {
  const cargoPath = join(crateDir, 'Cargo.toml');
  let original: string;
  try {
    original = readFileSync(cargoPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `write-crate-version: Cargo.toml not found at ${cargoPath}. The npm bundled-cli path cross-compiles a Rust CLI; \`bundle_cli.crate_path\` must point at a crate.`,
        { cause: err },
      );
    }
    throw err;
  }
  const updated = replaceCargoVersion(original, version);
  if (updated !== original) {writeFileSync(cargoPath, updated, 'utf8');}
  return [cargoPath];
}
