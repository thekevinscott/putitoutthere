import { parseEvidenceClause } from './parse-evidence-clause.js';
import type { Bullet } from './types.js';

export interface EvaluateBulletsOptions {
  bullets: Bullet[];
  allowedBuckets: ReadonlySet<string>;
  passedEvidence: (citation: string) => boolean;
  headSha: string;
}

/**
 * Validate each added bullet, returning the list of failure messages
 * (without the `::error::` prefix). A bullet fails when it has no
 * trailing evidence clause, an empty `(no fixture: ...)` reason, an
 * unsupported citation bucket, or a citation whose evidence never
 * succeeded. Comma-separated citations are checked independently.
 */
export function evaluateBullets(options: EvaluateBulletsOptions): string[] {
  const { bullets, allowedBuckets, passedEvidence, headSha } = options;
  const failures: string[] = [];

  for (const bullet of bullets) {
    const clause = parseEvidenceClause(bullet.text);
    if (!clause) {
      failures.push(
        `CHANGELOG.md:${bullet.line}: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause`,
      );
      continue;
    }

    if (clause.kind === 'no fixture') {
      if (!clause.value || clause.value === '<reason>') {
        failures.push(`CHANGELOG.md:${bullet.line}: '(no fixture: ...)' requires a non-empty reason`);
      }
      continue;
    }

    for (const citation of clause.value.split(',').map((part) => part.trim()).filter(Boolean)) {
      const bucket = citation.split('/')[0]!;
      if (!allowedBuckets.has(bucket)) {
        failures.push(
          `CHANGELOG.md:${bullet.line}: unsupported evidence bucket '${bucket}' in '${citation}'`,
        );
        continue;
      }

      if (!passedEvidence(citation)) {
        failures.push(
          `CHANGELOG.md:${bullet.line}: no successful GitHub Actions run or job matched '${citation}' on ${headSha}`,
        );
      }
    }
  }

  return failures;
}
