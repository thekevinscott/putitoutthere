/**
 * Whether a CHANGELOG.md line is the `## Unreleased` heading, mirroring the
 * bash `/^##\s+Unreleased\s*$/`. Explicit string ops rather than that regex:
 * under `RegExp.test()` the `\s`/`\s*`/`\s+` variants are indistinguishable
 * equivalent mutants (AGENTS.md, #442 / #520).
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
