/**
 * The set of run/job citations the poll loop must resolve before the gate
 * decides, matching the bash `citedRunNeedles`: every `verified by:` citation
 * (no-fixture bullets contribute none) whose bucket is allowed.
 */
import type { Bullet } from './evidence-check-types.js';
import { ALLOWED_BUCKETS } from './buckets.js';
import { bucketOf } from './bucket-of.js';
import { parseEvidenceClause } from './parse-evidence.js';
import { splitCitations } from './split-citations.js';

export function citedRunNeedles(bullets: readonly Bullet[]): Set<string> {
  const needles = new Set<string>();
  for (const bullet of bullets) {
    const evidence = parseEvidenceClause(bullet.text);
    if (evidence === null) {
      continue;
    }
    if (evidence.kind === 'no-fixture') {
      continue;
    }
    for (const citation of splitCitations(evidence.value)) {
      if (ALLOWED_BUCKETS.has(bucketOf(citation))) {
        needles.add(citation);
      }
    }
  }
  return needles;
}
