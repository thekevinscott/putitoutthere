/**
 * Decision core for the evidence-check gate (#445). I/O-free: given the
 * newly-added `## Unreleased` bullets, the base/head SHAs, and a
 * `passedEvidence` predicate (which the composition root binds to the live
 * GitHub Actions run state), decide pass/fail and the lines to emit. Extracted
 * from the inline bash in `.github/workflows/evidence-check.yml`; the decisions
 * and `::error::`/success text match it exactly (pinned in `decide.test.ts`).
 */
import { ALLOWED_BUCKETS } from './buckets.js';
import { bucketOf } from './bucket-of.js';
import type { Bullet, EvidenceCheckResult } from './evidence-check-types.js';
import { parseEvidenceClause } from './parse-evidence.js';
import { splitCitations } from './split-citations.js';

export interface EvidenceCheckInput {
  bullets: readonly Bullet[];
  baseSha: string;
  headSha: string;
  passedEvidence: (citation: string) => boolean;
}

export function decideEvidenceCheck(input: EvidenceCheckInput): EvidenceCheckResult {
  const { bullets, baseSha, headSha, passedEvidence } = input;
  const failures: string[] = [];

  for (const bullet of bullets) {
    const evidence = parseEvidenceClause(bullet.text);
    if (evidence === null) {
      failures.push(
        `CHANGELOG.md:${bullet.line}: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause`,
      );
      continue;
    }

    if (evidence.kind === 'no-fixture') {
      if (evidence.value === '' || evidence.value === '<reason>') {
        failures.push(`CHANGELOG.md:${bullet.line}: '(no fixture: ...)' requires a non-empty reason`);
      }
      continue;
    }

    for (const citation of splitCitations(evidence.value)) {
      const bucket = bucketOf(citation);
      if (!ALLOWED_BUCKETS.has(bucket)) {
        failures.push(`CHANGELOG.md:${bullet.line}: unsupported evidence bucket '${bucket}' in '${citation}'`);
        continue;
      }
      if (!passedEvidence(citation)) {
        failures.push(
          `CHANGELOG.md:${bullet.line}: no successful GitHub Actions run or job matched '${citation}' on ${headSha}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return { exitCode: 1, lines: failures.map((failure) => `::error::${failure}`) };
  }

  return {
    exitCode: 0,
    lines: [`Evidence check passed for CHANGELOG.md additions between ${baseSha} and ${headSha}.`],
  };
}
