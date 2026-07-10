import { describe, expect, it } from 'vitest';

import { addedUnreleasedBullets } from './added-unreleased-bullets.js';

const CHANGELOG = [
  '# Changelog', // 1
  '', // 2
  '## Unreleased', // 3
  '', // 4
  '- Fixed: a. (verified by: e2e/x)', // 5
  '- Fixed: b. (no fixture: y)', // 6
  '', // 7
  '## v0.0.1 → v0.0.2', // 8
  '', // 9
  '- old', // 10
].join('\n').split('\n');

describe('addedUnreleasedBullets', () => {
  it('collects added bullet lines that fall inside the Unreleased range', () => {
    const diff = [
      'diff --git a/CHANGELOG.md b/CHANGELOG.md',
      'index 111..222 100644',
      '--- a/CHANGELOG.md',
      '+++ b/CHANGELOG.md',
      '@@ -4,0 +5,2 @@',
      '+- Fixed: a. (verified by: e2e/x)',
      '+- Fixed: b. (no fixture: y)',
    ].join('\n').split('\n');

    expect(addedUnreleasedBullets(CHANGELOG, diff)).toEqual([
      { line: 5, text: '- Fixed: a. (verified by: e2e/x)' },
      { line: 6, text: '- Fixed: b. (no fixture: y)' },
    ]);
  });

  it('ignores added non-bullet lines, context lines, and removals', () => {
    const diff = [
      '--- a/CHANGELOG.md',
      '+++ b/CHANGELOG.md',
      '@@ -4,1 +5,2 @@',
      '+### Heading (not a bullet)',
      ' - Fixed: a. (verified by: e2e/x)',
      '-removed line',
      '+- Fixed: b. (no fixture: y)',
    ].join('\n').split('\n');

    // Line accounting: hunk sets newLine=5; `+### Heading` (5, not a bullet,
    // newLine→6); ` context` (6→7); `-removed` (skipped); `+- Fixed: b`
    // at line 7 — a bullet inside the range.
    expect(addedUnreleasedBullets(CHANGELOG, diff)).toEqual([
      { line: 7, text: '- Fixed: b. (no fixture: y)' },
    ]);
  });

  it('ignores added bullets that fall outside the Unreleased range', () => {
    const diff = [
      '--- a/CHANGELOG.md',
      '+++ b/CHANGELOG.md',
      '@@ -10,0 +10 @@',
      '+- another old entry',
    ].join('\n').split('\n');

    expect(addedUnreleasedBullets(CHANGELOG, diff)).toEqual([]);
  });

  it('returns nothing when the changelog has no Unreleased section', () => {
    const noUnreleased = '# Changelog\n\n## v1 → v2\n\n- x'.split('\n');
    const diff = ['@@ -0,0 +1 @@', '+- x'].join('\n').split('\n');
    expect(addedUnreleasedBullets(noUnreleased, diff)).toEqual([]);
  });
});
