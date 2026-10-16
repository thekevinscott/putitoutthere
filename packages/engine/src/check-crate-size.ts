/**
 * Crate-size pre-merge check (#362). crates.io rejects any `.crate` upload
 * over 10 MiB with `413 Payload Too Large`, and `cargo publish` surfaces that
 * only mid-release, after the verification build has compiled every dep. This
 * reproduces the tarball with `cargo package` at PR time instead.
 */

import { join } from 'node:path';

import type { CheckFinding } from './check.js';
import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import { packagedCrateBytes } from './packaged-crate-bytes.js';

// crates.io rejects any `.crate` upload over this size.
const CRATES_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * One finding per `kind = "crates"` package whose `cargo package`
 * `.crate` is over crates.io's upload limit. Empty when every crate is
 * within the limit — or when a crate's size can't be determined, in
 * which case the check skips it rather than inventing a finding.
 */
export async function checkCratesPackageSize(
  packages: readonly Package[],
): Promise<CheckFinding[]> {
  const findings: CheckFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'crates') {continue;}
    const cargoTomlPath = join(p.path, 'Cargo.toml');
    const compressedBytes = await packagedCrateBytes(cargoTomlPath);
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

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
