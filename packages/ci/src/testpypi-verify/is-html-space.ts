/**
 * Whether a single character is HTML whitespace (space, tab, newline, carriage
 * return) — the set that separates a tag name from its attributes and an
 * attribute name from its `=`. Used by the simple-index tag scanner. Pure.
 */

export function isHtmlSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
