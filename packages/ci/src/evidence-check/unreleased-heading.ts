/**
 * Whether a CHANGELOG.md line is the `## Unreleased` heading. Mirrors the
 * bash `/^##\s+Unreleased\s*$/`: exactly two hashes, then at least one
 * whitespace, then `Unreleased`, then only trailing whitespace. Implemented
 * with explicit string ops rather than a `\s+` quantifier regex — under
 * `RegExp.test()` the `\s`/`\s*`/`\s+` variants are indistinguishable and
 * would become unkillable equivalent mutants (see AGENTS.md #442 / #520).
 */
export function isUnreleasedHeading(line: string): boolean {
  if (!line.startsWith('##')) {
    return false;
  }
  const afterHashes = line.slice(2);
  const body = afterHashes.trimStart();
  // `\s+` between `##` and the title requires ≥1 whitespace that trimStart removed.
  if (body.length === afterHashes.length) {
    return false;
  }
  return body.trimEnd() === 'Unreleased';
}
