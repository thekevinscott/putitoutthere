/**
 * Whether an added line introduces a coverage escape-hatch marker — the strict
 * 100% rule the patch-coverage gate (#468) rejects outright. Reproduces the
 * `.mjs`'s `HATCH_RE = /\/\*\s*(?:v8|c8|istanbul)\s+ignore/i`: a `/*`, optional
 * whitespace, one of v8|c8|istanbul, at least one whitespace, then `ignore`,
 * case-insensitive, matched anywhere in the text. Pure.
 */

const HATCH_RE = /\/\*\s*(?:v8|c8|istanbul)\s+ignore/i;

export function isEscapeHatch(text: string): boolean {
  return HATCH_RE.test(text);
}
