import { describe, expect, it } from 'vitest';

import { unreleasedLineRange } from './unreleased-range.js';

const lines = (text: string): string[] => text.split('\n');

describe('unreleasedLineRange', () => {
  it('returns the 1-based line range between `## Unreleased` and the next `## `', () => {
    const changelog = lines(
      ['# Changelog', '', '## Unreleased', '', '- a', '', '## v1 → v2', '', '- b'].join('\n'),
    );
    // `## Unreleased` is line 3 (index 2); next `## ` is line 7 (index 6).
    expect(unreleasedLineRange(changelog)).toEqual({ start: 3, end: 7 });
  });

  it('runs the range to end-of-file when no later `## ` heading exists', () => {
    const changelog = lines(['# Changelog', '', '## Unreleased', '', '- a'].join('\n'));
    // 5 lines total; end = length + 1.
    expect(unreleasedLineRange(changelog)).toEqual({ start: 3, end: 6 });
  });

  it('returns null when there is no `## Unreleased` heading', () => {
    expect(unreleasedLineRange(lines('# Changelog\n\n## v1 → v2'))).toBeNull();
  });
});
