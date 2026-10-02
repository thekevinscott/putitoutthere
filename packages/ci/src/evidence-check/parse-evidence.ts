/**
 * Parse a bullet's trailing evidence clause, matching the bash
 * `/\((verified by|no fixture):\s*([^)]+)\)\s*$/i`. Located by structure
 * (trailing `)`, last `(`) with explicit string ops rather than that regex, so
 * no `.test()`-style quantifier survives mutation.
 */
import type { EvidenceClause } from './evidence-check-types.js';

const VERIFIED_PREFIX = 'verified by:';
const NO_FIXTURE_PREFIX = 'no fixture:';

export function parseEvidenceClause(text: string): EvidenceClause | null {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(')')) {
    return null;
  }

  const open = trimmed.lastIndexOf('(');
  if (open === -1) {
    return null;
  }

  const inner = trimmed.slice(open + 1, trimmed.length - 1);
  // `[^)]+` forbids a `)` inside the clause value.
  if (inner.includes(')')) {
    return null;
  }

  const lower = inner.toLowerCase();
  if (lower.startsWith(VERIFIED_PREFIX)) {
    // `[^)]+` requires ≥1 character after the colon (even whitespace).
    if (inner.length === VERIFIED_PREFIX.length) {
      return null;
    }
    return { kind: 'verified', value: inner.slice(VERIFIED_PREFIX.length).trim() };
  }
  if (lower.startsWith(NO_FIXTURE_PREFIX)) {
    if (inner.length === NO_FIXTURE_PREFIX.length) {
      return null;
    }
    return { kind: 'no-fixture', value: inner.slice(NO_FIXTURE_PREFIX.length).trim() };
  }
  return null;
}
