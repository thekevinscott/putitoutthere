/**
 * Decision core for the evidence-check gate (#445). I/O-free: given the
 * `changelog.d/` fragments the PR added (#730), the base/head SHAs, and a
 * `passedEvidence` predicate, decide pass/fail and the lines to emit.
 */
import { ALLOWED_BUCKETS } from './buckets.js';
import { bucketOf } from './bucket-of.js';
import type { EvidenceCheckResult, Fragment } from './evidence-check-types.js';
import { parseEvidenceClause } from './parse-evidence.js';
import { splitCitations } from './split-citations.js';

export interface EvidenceCheckInput {
  fragments: readonly Fragment[];
  baseSha: string;
  headSha: string;
  passedEvidence: (citation: string) => boolean;
}

export function decideEvidenceCheck(input: EvidenceCheckInput): EvidenceCheckResult {
  const { fragments, baseSha, headSha, passedEvidence } = input;
  const failures: string[] = [];

  for (const fragment of fragments) {
    if (fragment.bullets.length === 0) {
      failures.push(
        `${fragment.path}: no '- ' bullet; each changelog entry is a bullet ending in its evidence clause`,
      );
    }

    for (const bullet of fragment.bullets) {
      const at = `${bullet.path}:${bullet.line}`;
      const evidence = parseEvidenceClause(bullet.text);
      if (evidence === null) {
        failures.push(`${at}: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause`);
        continue;
      }

      if (evidence.kind === 'no-fixture') {
        if (evidence.value === '' || evidence.value === '<reason>') {
          failures.push(`${at}: '(no fixture: ...)' requires a non-empty reason`);
        }
        continue;
      }

      for (const citation of splitCitations(evidence.value)) {
        const bucket = bucketOf(citation);
        if (!ALLOWED_BUCKETS.has(bucket)) {
          failures.push(`${at}: unsupported evidence bucket '${bucket}' in '${citation}'`);
          continue;
        }
        if (!passedEvidence(citation)) {
          failures.push(`${at}: no successful GitHub Actions run or job matched '${citation}' on ${headSha}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    return { exitCode: 1, lines: failures.map((failure) => `::error::${failure}`) };
  }

  return {
    exitCode: 0,
    lines: [`Evidence check passed for changelog.d/ fragments added between ${baseSha} and ${headSha}.`],
  };
}
