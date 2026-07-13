/**
 * Whether a 1-based line number falls inside a `[start, end)` range — the
 * `line >= start && line < end` test the bash used to keep a bullet within the
 * Unreleased section. Two single-comparison guards rather than one compound
 * `&&` so each bound is independently mutation-killable.
 */
export function isWithinRange(line: number, range: { start: number; end: number }): boolean {
  if (line < range.start) {
    return false;
  }
  return line < range.end;
}
