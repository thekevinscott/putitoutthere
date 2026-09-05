import type { Package } from '../config.js';
import { checkPyprojectShape } from '../preflight.js';
import type { CheckFinding } from './check-types.js';

export async function checkPyprojectShapeFindings(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkPyprojectShape(packages)) {
    findings.push({
      package: f.package,
      message: `[${f.code}] ${f.pyprojectPath}: ${f.detail}`,
    });
  }
}
