import type { Package } from '../config.js';
import { ErrorCodes } from '../error-codes.js';
import { checkCratesMetadata } from '../preflight.js';
import type { CheckFinding } from '../check.js';

export async function checkCratesPackageMetadata(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkCratesMetadata(packages)) {
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.CRATES_MISSING_METADATA}] ${f.cargoTomlPath} missing required Cargo.toml [package] field(s): ${f.missing.join(', ')}. crates.io rejects the publish after cargo's verification build.`,
    });
  }
}
