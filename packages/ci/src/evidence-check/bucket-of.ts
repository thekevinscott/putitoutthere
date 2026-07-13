/**
 * The bucket segment of a citation — everything before its first `/`, matching
 * the bash `citation.split('/')[0]` (`e2e/js-vanilla` → `e2e`, `unit` → `unit`).
 * `indexOf`/`slice` rather than `split('/')[0]` so there is no unreachable
 * `[0] ?? ''` fallback branch to leave uncovered.
 */
export function bucketOf(citation: string): string {
  const slash = citation.indexOf('/');
  return slash === -1 ? citation : citation.slice(0, slash);
}
