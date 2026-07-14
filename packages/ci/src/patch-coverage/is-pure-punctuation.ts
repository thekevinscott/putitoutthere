/**
 * Whether a trimmed line is made up entirely of the punctuation characters v8
 * never instruments (`(`, `)`, `{`, `}`, `[`, `]`, `;`, `,`) — e.g. `}` or
 * `});`. Reproduces the `.mjs`'s `/^[(){}\[\];,]+$/.test(trimmed)` as an
 * explicit non-empty character-set check (no regex quantifier, so the
 * one-or-more semantics can't survive as an equivalent mutant). Pure.
 */

const PUNCTUATION = new Set(['(', ')', '{', '}', '[', ']', ';', ',']);

export function isPurePunctuation(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const ch of text) {
    if (!PUNCTUATION.has(ch)) {
      return false;
    }
  }
  return true;
}
