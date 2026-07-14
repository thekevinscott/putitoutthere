/**
 * The absolute post-image line number a unified-diff hunk header opens on —
 * the `+C` in `@@ -A,B +C,D @@`. Reproduces the `.mjs`'s
 * `/^@@ -\d+(?:,\d+)? \+(\d+)/` capture without a regex quantifier (which
 * would be an unkillable equivalent mutant): it takes the third
 * space-separated token, requires it to start with `+`, keeps the digits up to
 * the optional `,`, and validates them character-by-character before
 * converting. Returns null for a header it can't read. Pure.
 */

export function parseHunkStart(raw: string): number | null {
  const token = raw.split(' ')[2];
  if (token === undefined || !token.startsWith('+')) {
    return null;
  }
  const afterPlus = token.slice(1);
  const comma = afterPlus.indexOf(',');
  const digits = comma === -1 ? afterPlus : afterPlus.slice(0, comma);
  if (digits.length === 0) {
    return null;
  }
  for (const ch of digits) {
    if (ch < '0' || ch > '9') {
      return null;
    }
  }
  return Number(digits);
}
