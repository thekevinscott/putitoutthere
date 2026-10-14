import { checkPyprojectShape } from './check-pyproject-shape.js';
import type { Package } from './config.js';

export async function requirePyprojectShape(packages: readonly Package[]): Promise<void> {
  const findings = await checkPyprojectShape(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    'Pre-flight pyproject.toml shape check failed:',
    '',
  ];
  for (const f of findings) {
    lines.push(`  [${f.code}] ${f.package}: ${f.pyprojectPath}`);
    lines.push(`    ${f.detail}`);
  }
  lines.push(
    '',
    'Why: these mismatches would otherwise surface 10-20 minutes into a release run',
    'when the build backend (maturin / setuptools / hatchling) finally tripped on them.',
    'Fix the pyproject.toml + putitoutthere.toml fields in this list, then re-run.',
  );
  throw new Error(lines.join('\n'));
}
