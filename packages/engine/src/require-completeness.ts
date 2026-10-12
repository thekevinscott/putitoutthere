import { checkCompleteness, type MatrixRow } from './completeness.js';
import { expectedLayout } from './expected-layout.js';

export async function requireCompleteness(
  matrix: readonly MatrixRow[],
  artifactsRoot: string,
): Promise<void> {
  const results = await checkCompleteness(matrix, artifactsRoot);
  const failed = [...results.entries()].filter(([, r]) => !r.ok);
  if (failed.length === 0) {return;}

  const lines: string[] = ['Artifact completeness check failed:'];
  for (const [pkg, result] of failed) {
    lines.push(`  ${pkg}:`);
    for (const m of result.missing) {
      lines.push(`    - target=${m.row.target} artifact=${m.row.artifact_name}: ${m.reason}`);
      lines.push(`      expected: ${expectedLayout(m.row)}`);
    }
  }
  lines.push('');
  lines.push('Naming contract: plan.md §12.4 (artifacts/{artifact_name}/).');
  lines.push('No side effects performed. Fix the build and re-run.');
  throw new Error(lines.join('\n'));
}
