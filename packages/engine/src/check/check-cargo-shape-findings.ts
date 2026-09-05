import type { Package } from '../config.js';
import { checkCargoShape } from '../preflight.js';
import type { CheckFinding } from './check-types.js';

export async function checkCargoShapeFindings(
  packages: readonly Package[],
  cwd: string,
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkCargoShape(packages, { cwd })) {
    findings.push({
      package: f.package,
      message: `[${f.code}] ${f.cargoTomlPath}: ${f.detail}`,
    });
  }
}
