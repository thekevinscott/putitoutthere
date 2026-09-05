import type { Package } from '../config.js';
import { checkPackageJsonShape } from '../preflight.js';
import type { CheckFinding } from '../check.js';

export async function checkPackageJsonShapeFindings(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkPackageJsonShape(packages)) {
    findings.push({
      package: f.package,
      message: `[${f.code}] ${f.packageJsonPath}: ${f.detail}`,
    });
  }
}
