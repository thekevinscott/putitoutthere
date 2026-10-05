/**
 * Dependency-skew detection over a plan's per-package verdicts (#412, #403):
 * a package would PUBLISH while a `depends_on` dependency SKIPs (already
 * published / stuck), so the dependent ships ahead of its dependency. Pure
 * over {verdicts, packages} — the registry reads happen in `computePlanStatus`.
 */

import type { Package } from './config.js';
import type { PlanVerdict, SkewWarning } from './plan-status-types.js';

export function computeSkew(
  verdicts: readonly PlanVerdict[],
  byName: ReadonlyMap<string, Package>,
): SkewWarning[] {
  const verdictByName = new Map(verdicts.map((v) => [v.package, v.verdict]));
  const out: SkewWarning[] = [];
  for (const v of verdicts) {
    // Only a PUBLISHing dependent can skew; a skipped dependent is fine.
    if (v.verdict !== 'publish') {continue;}
    const deps = byName.get(v.package)?.depends_on ?? [];
    for (const dep of deps) {
      if (verdictByName.get(dep) === 'skip') {
        out.push({ dependent: v.package, dependency: dep });
      }
    }
  }
  return out;
}
