import type { Package } from '../config.js';
import { matchesAny } from '../glob.js';
import type { CheckFinding } from '../check.js';
import { listTrackedFiles } from './list-tracked-files.js';

export async function checkGlobsMatchTrackedFiles(
  packages: readonly Package[],
  cwd: string,
  findings: CheckFinding[],
): Promise<void> {
  const tracked = await listTrackedFiles(cwd);
  if (tracked === null) {return;}
  for (const p of packages) {
    const matched = tracked.some((f) => matchesAny(p.globs, f));
    if (!matched) {
      findings.push({
        package: p.name,
        message: `globs ${JSON.stringify(p.globs)} matched no tracked files. Empty globs mean the package will never cascade on a real commit.`,
      });
    }
  }
}
