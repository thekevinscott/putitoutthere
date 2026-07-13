/**
 * Whether added CHANGELOG.md text is a Markdown bullet. Mirrors the bash
 * `/^\s*-\s+/`: optional leading whitespace, a `-`, then at least one
 * whitespace. Explicit string ops rather than a `\s*`/`\s+` quantifier regex —
 * under `RegExp.test()` those quantifier variants are indistinguishable and
 * would be unkillable equivalent mutants (AGENTS.md #442 / #520).
 */
export function isBulletLine(text: string): boolean {
  const afterLeadingWs = text.trimStart();
  if (!afterLeadingWs.startsWith('-')) {
    return false;
  }
  const afterDash = afterLeadingWs.slice(1);
  // `\s+` after the dash requires ≥1 whitespace that trimStart removed.
  return afterDash.trimStart().length !== afterDash.length;
}
