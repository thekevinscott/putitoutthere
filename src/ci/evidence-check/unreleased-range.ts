/**
 * Locate the `## Unreleased` section in a CHANGELOG, split into lines.
 * Returns the 1-based line range `[start, end)` covering the lines
 * *after* the heading up to (but not including) the next `## ` heading,
 * or the end of file. Returns `null` when there is no `## Unreleased`.
 */
export function unreleasedLineRange(changelog: string[]): { start: number; end: number } | null {
  const start = changelog.findIndex((line) => /^##\s+Unreleased\s*$/.test(line));
  if (start === -1) {
    return null;
  }
  const next = changelog.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return { start: start + 1, end: next === -1 ? changelog.length + 1 : next + 1 };
}
