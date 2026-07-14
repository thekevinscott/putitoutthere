/**
 * Pins how the patch-coverage gate (#468) turns a `git diff --unified=0
 * --no-prefix -M` post-image into the added `src/**` lines it must cover.
 * Reproduces the `.mjs`'s unified-diff walk:
 *   - `+++ <path>` sets the current post-image file (`/dev/null` clears it);
 *   - `@@ … +C[,D] @@` resets the running absolute line number to C;
 *   - `+` lines inside a counted file record { line, text } and advance the
 *     line counter; test/decl/out-of-scope files advance but don't record;
 *   - ` ` context lines advance; `-` lines are ignored (post-image only).
 * Pure; exact assertions on the returned per-file added-line lists.
 */

import { describe, expect, it } from 'vitest';

import { parseAddedLines } from './parse-added-lines.js';

describe('parseAddedLines', () => {
  it('records added lines in a counted engine src file with absolute line numbers', () => {
    const diff = [
      'diff --git packages/engine/src/foo.ts packages/engine/src/foo.ts',
      '--- packages/engine/src/foo.ts',
      '+++ packages/engine/src/foo.ts',
      '@@ -4,0 +5,2 @@',
      '+const x = 1;',
      '+const y = 2;',
      '',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      {
        file: 'packages/engine/src/foo.ts',
        added: [
          { line: 5, text: 'const x = 1;' },
          { line: 6, text: 'const y = 2;' },
        ],
      },
    ]);
  });

  it('re-bases the line counter at each hunk header', () => {
    const diff = [
      '+++ packages/engine/src/foo.ts',
      '@@ -1,0 +2,1 @@',
      '+const a = 1;',
      '@@ -10,0 +20,1 @@',
      '+const b = 2;',
      '',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      {
        file: 'packages/engine/src/foo.ts',
        added: [
          { line: 2, text: 'const a = 1;' },
          { line: 20, text: 'const b = 2;' },
        ],
      },
    ]);
  });

  it('advances the line counter across context and removed lines', () => {
    // A context line advances the post-image counter; a removed line does not.
    const diff = [
      '+++ packages/engine/src/foo.ts',
      '@@ -5,2 +5,2 @@',
      ' const untouched = 0;',
      '-const gone = 1;',
      '+const added = 2;',
      '',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      {
        file: 'packages/engine/src/foo.ts',
        added: [{ line: 6, text: 'const added = 2;' }],
      },
    ]);
  });

  it('ignores additions in *.test.ts files', () => {
    const diff = ['+++ packages/engine/src/foo.test.ts', '@@ -0,0 +1,1 @@', '+it("x", () => {});', ''].join('\n');
    expect(parseAddedLines(diff)).toEqual([]);
  });

  it('ignores additions outside packages/engine/src/', () => {
    const diff = ['+++ packages/ci/src/cli.ts', '@@ -0,0 +1,1 @@', '+const nope = 1;', ''].join('\n');
    expect(parseAddedLines(diff)).toEqual([]);
  });

  it('ignores additions in a non-.ts engine src file', () => {
    const diff = ['+++ packages/engine/src/data.json', '@@ -0,0 +1,1 @@', '+{"k":1}', ''].join('\n');
    expect(parseAddedLines(diff)).toEqual([]);
  });

  it('drops a file whose post-image is /dev/null (a deletion)', () => {
    const diff = ['--- packages/engine/src/gone.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-const x = 1;', ''].join('\n');
    expect(parseAddedLines(diff)).toEqual([]);
  });

  it('separates additions across two counted files', () => {
    const diff = [
      '+++ packages/engine/src/a.ts',
      '@@ -0,0 +1,1 @@',
      '+const a = 1;',
      '+++ packages/engine/src/b.ts',
      '@@ -0,0 +3,1 @@',
      '+const b = 1;',
      '',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      { file: 'packages/engine/src/a.ts', added: [{ line: 1, text: 'const a = 1;' }] },
      { file: 'packages/engine/src/b.ts', added: [{ line: 3, text: 'const b = 1;' }] },
    ]);
  });

  it('preserves the exact added text including leading indentation', () => {
    const diff = ['+++ packages/engine/src/foo.ts', '@@ -0,0 +1,1 @@', '+  return value;', ''].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      { file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: '  return value;' }] },
    ]);
  });

  it('returns an empty list for a diff with no added src lines', () => {
    expect(parseAddedLines('')).toEqual([]);
  });

  it('does not record an added line that itself begins with +++', () => {
    // The `+++`/`---` in-hunk guard: a `+` line whose body starts with `++`
    // (so the raw line is `+++…`) is treated as a header artefact, not code.
    const diff = ['+++ packages/engine/src/foo.ts', '@@ -0,0 +1,1 @@', '+++weird', ''].join('\n');
    expect(parseAddedLines(diff)).toEqual([]);
  });
});
