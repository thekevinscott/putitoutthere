/**
 * The absolute post-image line number a unified-diff hunk header opens on —
 * the `+C` in `@@ -A,B +C,D @@`. Reproduces the `.mjs`'s
 * `/^@@ -\d+(?:,\d+)? \+(\d+)/` capture without a `\d+` quantifier (which would
 * be an unkillable equivalent mutant): it takes the third space-separated
 * token, requires it to start with `+`, and `parseInt`s the digits after it
 * (`parseInt` stops at the `,` on its own). Returns null for a header it can't
 * read. Pure.
 */

export function parseHunkStart(raw: string): number | null {
  const plus = raw.split(' ')[2];
  if (plus === undefined || !plus.startsWith('+')) {
    return null;
  }
  const parsed = parseInt(plus.slice(1), 10);
  return Number.isNaN(parsed) ? null : parsed;
}
