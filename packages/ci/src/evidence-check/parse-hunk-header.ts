/**
 * Parse a unified-diff hunk header, returning the new-file starting line, or
 * `null` when the line is not one. The captured `+N` start drives added-bullet
 * line numbering; it is consumed (`Number(...)`), so a quantifier mutation
 * changes the parsed number and is killable, unlike a `RegExp.test()` one.
 */
export function parseHunkHeader(line: string): number | null {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (match === null) {
    return null;
  }
  return Number(match[1]);
}
