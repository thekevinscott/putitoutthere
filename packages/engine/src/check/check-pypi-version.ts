import type { Package } from '../config.js';
import { ErrorCodes } from '../error-codes.js';
import { checkPypiVersionSource } from '../preflight.js';
import type { CheckFinding } from './check-types.js';

export async function checkPypiVersion(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkPypiVersionSource(packages)) {
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.PYPI_STATIC_VERSION}] ${f.pyprojectPath} declares a static \`[project].version\` literal. Use \`[project].dynamic = ["version"]\` with hatch-vcs (recommended), setuptools-scm, or the maturin Cargo.toml-driven path — putitoutthere does not edit pyproject.toml at release time, so a literal silently ships the previous release.`,
    });
  }
}
