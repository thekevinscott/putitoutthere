import { describe, expect, it } from 'vitest';

import { addedUnreleasedBullets } from './added-bullets.js';

describe('addedUnreleasedBullets', () => {
  it('returns no bullets when the changelog has no Unreleased section', () => {
    const changelog = ['# Changelog', '## v1.0.0', '- old'];
    const patch = ['@@ -1,0 +2,1 @@', '+- new'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([]);
  });

  it('collects added bullets inside the Unreleased range, excluding later sections', () => {
    // Range for this changelog is [1, 4): lines 1..3 (heading + two bullets).
    const changelog = ['## Unreleased', '- a', '- b', '## v1', '- c'];
    const patch = ['@@ -1,0 +2,2 @@', '+- a', '+- b', '@@ -3,0 +5,1 @@', '+- c'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([
      { line: 2, text: '- a' },
      { line: 3, text: '- b' },
    ]);
  });

  it('skips file headers, counts context lines, and ignores removals', () => {
    const changelog = ['## Unreleased', '- x'];
    const patch = [
      '--- a/CHANGELOG.md',
      '+++ b/CHANGELOG.md',
      '@@ -1,1 +1,3 @@',
      ' ## Unreleased',
      '+- new (verified by: unit/x)',
      '-removed old line',
    ];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([
      { line: 2, text: '- new (verified by: unit/x)' },
    ]);
  });

  it('ignores added non-bullet lines inside the range', () => {
    const changelog = ['## Unreleased', '- x', '- y'];
    const patch = ['@@ -1,0 +2,2 @@', '+not a bullet', '+- yes a bullet'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([{ line: 3, text: '- yes a bullet' }]);
  });
});

describe('addedUnreleasedBullets: mutation guards', () => {
  it('does not count removal lines toward the new-file line number', () => {
    const changelog = ['## Unreleased', '- x', '- y'];
    const patch = ['@@ -1,1 +1,2 @@', '-old removed', '+- new bullet'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([{ line: 1, text: '- new bullet' }]);
  });

  it('skips a +++-prefixed added line without advancing the line number', () => {
    // If the +++ skip were dropped, the +++ line would be counted and the
    // bullet below it would land on line 3, not line 2.
    const changelog = ['## Unreleased', '- x', '- y'];
    const patch = ['@@ -1,0 +2,2 @@', '+++weird', '+- new bullet'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([{ line: 2, text: '- new bullet' }]);
  });

  it('includes a bullet exactly on the range start line', () => {
    const changelog = ['## Unreleased', '- a'];
    const patch = ['@@ -1,0 +1,1 @@', '+- at range start'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([{ line: 1, text: '- at range start' }]);
  });

  it('excludes a bullet on the next-section line (range end is exclusive)', () => {
    const changelog = ['## Unreleased', '- a', '## v1.0.0'];
    const patch = ['@@ -3,0 +3,1 @@', '+- on the next section line'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([]);
  });

  it('excludes an added bullet that falls after the Unreleased section', () => {
    const changelog = ['## Unreleased', '## v1.0.0', '- old'];
    const patch = ['@@ -3,0 +3,1 @@', '+- belongs to v1'];
    expect(addedUnreleasedBullets(changelog, patch)).toEqual([]);
  });
});
