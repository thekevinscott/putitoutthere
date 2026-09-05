import type { Package } from '../config.js';
import { assertTripleSupported } from '../handlers/npm-platform.js';
import { toError } from '../to-error.js';
import { normalizeTarget, type TargetEntry } from '../types.js';
import type { CheckFinding } from './check-types.js';

export function checkNpmTargetTriples(
  packages: readonly Package[],
  findings: CheckFinding[],
): void {
  for (const p of packages) {
    if (p.kind !== 'npm') {continue;}
    const targets = (p as { targets?: TargetEntry[] }).targets;
    if (!targets) {continue;}
    for (const t of targets) {
      const { triple } = normalizeTarget(t);
      try {
        assertTripleSupported(triple, p.name);
      } catch (err) {
        findings.push({
          package: p.name,
          message: toError(err).message,
        });
      }
    }
  }
}
