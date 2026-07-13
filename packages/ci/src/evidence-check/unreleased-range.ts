/**
 * The 1-based line range covered by the `## Unreleased` section, matching the
 * bash `unreleasedLineRange`. `start` is the heading's own 1-based line number
 * (`headingIndex + 1`); `end` is the 1-based line number of the next `## `
 * heading, or one past the last line when Unreleased is the final section.
 * Returns `null` when there is no `## Unreleased` heading.
 */
import { isSectionHeading } from './section-heading.js';
import { isUnreleasedHeading } from './unreleased-heading.js';

export function unreleasedLineRange(changelog: readonly string[]): { start: number; end: number } | null {
  const start = changelog.findIndex(isUnreleasedHeading);
  if (start === -1) {
    return null;
  }
  const next = changelog.findIndex((line, index) => index > start && isSectionHeading(line));
  return { start: start + 1, end: next === -1 ? changelog.length + 1 : next + 1 };
}
