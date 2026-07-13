/**
 * Accepted `verified by:` citation buckets (AGENTS.md "Verification policy").
 * A citation's bucket is the segment before its first `/` (`e2e/js-vanilla`
 * → `e2e`); only these four are honoured.
 */
export const ALLOWED_BUCKETS: ReadonlySet<string> = new Set(['e2e', 'integration', 'unit', 'consumer-template']);
