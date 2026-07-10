import { unreleasedLineRange } from './unreleased-range.js';
import type { Bullet } from './types.js';

/**
 * Walk a `git diff --unified=0` patch (split into lines) and collect the
 * bullet lines it *adds* inside the changelog's `## Unreleased` range.
 * Line numbers are tracked against the post-image so each returned
 * bullet carries its 1-based CHANGELOG line.
 */
export function addedUnreleasedBullets(changelog: string[], patch: string[]): Bullet[] {
  const range = unreleasedLineRange(changelog);
  if (!range) {
    return [];
  }

  const bullets: Bullet[] = [];
  let newLine = 0;

  for (const raw of patch) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (raw.startsWith('+++') || raw.startsWith('---')) {
      continue;
    }

    if (raw.startsWith('+')) {
      const text = raw.slice(1);
      if (newLine >= range.start && newLine < range.end && /^\s*-\s+/.test(text)) {
        bullets.push({ line: newLine, text });
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
