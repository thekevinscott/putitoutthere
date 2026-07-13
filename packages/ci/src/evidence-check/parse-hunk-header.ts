/**
 * Parse a unified-diff hunk header, returning the new-file starting line, or
 * `null` when the line is not a hunk header. Mirrors the bash
 * `/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/` — the captured `+N` start drives
 * the added-bullet line numbering. The capture is consumed (`Number(...)`),
 * so a quantifier mutation changes the parsed number and is killable, unlike
 * a `RegExp.test()` quantifier.
 */
export function parseHunkHeader(line: string): number | null {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (match === null) {
    return null;
  }
  return Number(match[1]);
}
