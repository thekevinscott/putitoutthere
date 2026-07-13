/**
 * Split a `verified by:` clause value into its individual citations, matching
 * the bash `.split(',').map((p) => p.trim()).filter(Boolean)`: comma-separated,
 * each trimmed, empties dropped.
 */
export function splitCitations(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}
