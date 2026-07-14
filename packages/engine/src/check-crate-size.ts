/**
 * Crate-size pre-merge check (#362).
 *
 * crates.io rejects any `.crate` upload over 10 MiB with `413 Payload
 * Too Large`, but `cargo publish` surfaces that only mid-release, after
 * the verification build has compiled the crate and every transitive
 * dep — the release surprise the no-surprises design commitment exists
 * to eliminate. `checkCratesPackageSize` reproduces the tarball with
 * `cargo package` at PR time, so a tracked symlink dragging a build
 * tree into the crate, or a missing `[package].exclude`, is caught on
 * the PR that introduces it.
 *
 * Wired into `runChecks` (`check.ts`). The end-to-end path through the
 * config loader is covered by
 * `tests/integration/check-crate-size.integration.test.ts`.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';

import type { CheckFinding } from './check.js';
import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';

// crates.io rejects any `.crate` upload over this size.
const CRATES_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const CARGO_SIZE_UNIT_BYTES: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

/**
 * One finding per `kind = "crates"` package whose `cargo package`
 * `.crate` is over crates.io's upload limit. Empty when every crate is
 * within the limit — or when a crate's size can't be determined, in
 * which case the check skips it rather than inventing a finding.
 */
export function checkCratesPackageSize(
  packages: readonly Package[],
): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'crates') {continue;}
    const cargoTomlPath = join(p.path, 'Cargo.toml');
    const compressedBytes = packagedCrateBytes(cargoTomlPath);
    if (compressedBytes === null) {continue;}
    if (compressedBytes > CRATES_MAX_UPLOAD_BYTES) {
      findings.push({
        package: p.name,
        message: `[${ErrorCodes.CRATES_PACKAGE_TOO_LARGE}] ${cargoTomlPath}: cargo package produces a ${formatMiB(compressedBytes)} .crate, over crates.io's ${formatMiB(CRATES_MAX_UPLOAD_BYTES)} (${CRATES_MAX_UPLOAD_BYTES}-byte) upload limit. cargo publish would fail with 413 Payload Too Large mid-release; a tracked symlink into a build directory or a missing [package].exclude is the usual cause.`,
      });
    }
  }
  return findings;
}

/**
 * Compressed size in bytes of the `.crate` `cargo package` would
 * upload, or null when it can't be determined — cargo is absent, cargo
 * rejected the manifest, or its output carried no size line. Null means
 * "can't verify": the check skips rather than inventing a size finding,
 * mirroring the null-means-skip shape `listTrackedFiles` uses outside a
 * git repo.
 */
function packagedCrateBytes(cargoTomlPath: string): number | null {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(
      'cargo',
      ['package', '--no-verify', '--allow-dirty', '--manifest-path', cargoTomlPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return null;
  }
  if (result.error !== undefined) {return null;}
  if (result.status !== 0) {return null;}
  return parseCargoCompressedBytes(result.stderr);
}

/**
 * Pull the compressed `.crate` size out of `cargo package`'s summary
 * line, which cargo writes to stderr:
 *   `    Packaged 7 files, 24.0KiB (8.9KiB compressed)`
 */
function parseCargoCompressedBytes(cargoStderr: string): number | null {
  const m = /Packaged\b[^\n]*?\(\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s+compressed\s*\)/.exec(
    cargoStderr,
  );
  if (m === null) {return null;}
  const [, rawValue, rawUnit] = m as unknown as [string, string, string];
  const unit = CARGO_SIZE_UNIT_BYTES[rawUnit];
  if (unit === undefined) {return null;}
  return Math.round(Number.parseFloat(rawValue) * unit);
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
