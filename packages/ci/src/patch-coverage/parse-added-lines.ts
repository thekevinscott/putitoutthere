/**
 * Turns a `git diff --unified=0 --no-prefix -M` post-image into the added
 * `packages/engine/src/**` lines the patch-coverage gate (#468) must cover.
 * Reproduces the `.mjs`'s unified-diff walk exactly:
 *   - `+++ <path>` sets the current post-image file (`/dev/null` clears it);
 *   - `@@ … +C[,D] @@` re-bases the running absolute line number to C;
 *   - a `+` line inside a counted file records { line, text } and advances the
 *     counter; a `+` line in a test/decl/out-of-scope file only advances it;
 *   - a ` ` context line advances the counter; a `-` line is ignored (we track
 *     post-image rows only); an in-hunk `+++`/`---` row is a header artefact.
 * Pure.
 */

import { isCountedSrcPath } from './is-counted-src-path.js';
import { parseHunkStart } from './parse-hunk-start.js';
import type { AddedFile, AddedLine } from './patch-coverage-types.js';

export function parseAddedLines(diffOut: string): AddedFile[] {
  const byFile = new Map<string, AddedLine[]>();
  let currentFile: string | null = null;
  let nextLine = 0;

  for (const raw of diffOut.split('\n')) {
    if (raw.startsWith('+++ ')) {
      // The post-image path. A deletion's `+++ /dev/null` needs no special
      // case: `/dev/null` is not a counted src path, so `isCountedSrcPath`
      // rejects it below exactly as the `.mjs`'s explicit null did.
      currentFile = raw.slice(4).trim();
      continue;
    }
    if (raw.startsWith('@@ ')) {
      const start = parseHunkStart(raw);
      if (start !== null) {
        nextLine = start;
      }
      continue;
    }
    if (currentFile === null) {
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      continue;
    }
    if (raw.startsWith('+')) {
      // Only counted files record and advance the counter. An added line in a
      // test/decl/out-of-scope file records nothing, and its counter value is
      // never observed (the next `@@` resets `nextLine`), so it is skipped
      // outright rather than counted — matching the `.mjs`'s behaviour without
      // a dead increment.
      if (isCountedSrcPath(currentFile)) {
        const list = byFile.get(currentFile) ?? [];
        list.push({ line: nextLine, text: raw.slice(1) });
        byFile.set(currentFile, list);
        nextLine++;
      }
    } else if (raw.startsWith(' ')) {
      nextLine++;
    }
  }

  return [...byFile.entries()].map(([file, added]) => ({ file, added }));
}
