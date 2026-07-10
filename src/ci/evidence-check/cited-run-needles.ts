import { parseEvidenceClause } from './parse-evidence-clause.js';
import type { Bullet } from './types.js';

/**
 * Collect the set of citations that need a matching workflow run: every
 * comma-separated citation from a `verified by` bullet whose bucket is
 * allowed. `no fixture` bullets and unknown buckets are skipped — they
 * carry no run to wait on.
 */
export function citedRunNeedles(bullets: Bullet[], allowedBuckets: ReadonlySet<string>): Set<string> {
  const needles = new Set<string>();
  for (const bullet of bullets) {
    const clause = parseEvidenceClause(bullet.text);
    if (!clause || clause.kind === 'no fixture') {
      continue;
    }
    for (const citation of clause.value.split(',').map((part) => part.trim()).filter(Boolean)) {
      if (allowedBuckets.has(citation.split('/')[0]!)) {
        needles.add(citation);
      }
    }
  }
  return needles;
}
