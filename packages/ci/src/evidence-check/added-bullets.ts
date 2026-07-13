/**
 * The newly-added `## Unreleased` bullets in a `git diff --unified=0`
 * CHANGELOG.md patch, matching the bash `addedUnreleasedBullets`. Walks the
 * patch tracking the new-file line number, and records `+` lines that fall
 * inside the Unreleased range and look like a bullet. Returns `[]` when there
 * is no Unreleased section.
 */
import type { Bullet } from './evidence-check-types.js';
import { isBulletLine } from './bullet-line.js';
import { isWithinRange } from './is-within-range.js';
import { parseHunkHeader } from './parse-hunk-header.js';
import { unreleasedLineRange } from './unreleased-range.js';

export function addedUnreleasedBullets(changelog: readonly string[], patch: readonly string[]): Bullet[] {
  const range = unreleasedLineRange(changelog);
  if (range === null) {
    return [];
  }

  const bullets: Bullet[] = [];
  let newLine = 0;

  for (const raw of patch) {
    const hunkStart = parseHunkHeader(raw);
    if (hunkStart !== null) {
      newLine = hunkStart;
      continue;
    }

    // A `+++`-prefixed patch line (the `+++ b/file` header, or a rare added
    // line whose content starts with `++`) must not be counted as an added
    // line. The bash also skipped `---`, but a `---` line is handled
    // identically by the removal path below (no increment), so it is omitted
    // here — keeping it would only add an equivalent, unkillable mutant.
    if (raw.startsWith('+++')) {
      continue;
    }

    if (raw.startsWith('+')) {
      const text = raw.slice(1);
      // Nested (not `&&`) so each condition is an independently killable
      // single-call `if` rather than one compound test.
      if (isWithinRange(newLine, range)) {
        if (isBulletLine(text)) {
          bullets.push({ line: newLine, text });
        }
      }
      newLine += 1;
      continue;
    }

    if (!raw.startsWith('-')) {
      newLine += 1;
    }
  }

  return bullets;
}
