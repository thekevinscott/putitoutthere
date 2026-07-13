/**
 * Whether a CHANGELOG.md line opens a new `## ` section. Mirrors the bash
 * `/^##\s+/`: exactly two hashes followed by at least one whitespace. Used to
 * find where the `## Unreleased` section ends. Explicit string ops, not a
 * `\s+` quantifier regex, for the same mutation-killability reason as
 * `isUnreleasedHeading`.
 */
export function isSectionHeading(line: string): boolean {
  if (!line.startsWith('##')) {
    return false;
  }
  const afterHashes = line.slice(2);
  // `\s+` requires ≥1 leading whitespace that trimStart removed.
  return afterHashes.trimStart().length !== afterHashes.length;
}
