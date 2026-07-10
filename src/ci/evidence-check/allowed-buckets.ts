/**
 * Accepted `verified by:` evidence buckets. A citation's bucket is the
 * segment before its first `/` (e.g. `e2e` in `e2e/js-vanilla-firstpub`).
 * Keep in sync with AGENTS.md > "Verification policy".
 */
export const ALLOWED_BUCKETS: ReadonlySet<string> = new Set([
  'e2e',
  'integration',
  'unit',
  'consumer-template',
]);
