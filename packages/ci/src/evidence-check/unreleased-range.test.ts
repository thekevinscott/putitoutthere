import { describe, expect, it } from 'vitest';

import { unreleasedLineRange } from './unreleased-range.js';

describe('unreleasedLineRange', () => {
  it('returns null when there is no Unreleased heading', () => {
    expect(unreleasedLineRange(['# Changelog', '## v1.0.0', '- old'])).toBeNull();
  });

  it('spans from the heading line to the next section', () => {
    // 0-based: Unreleased at index 1, next section at index 3.
    const range = unreleasedLineRange(['# Changelog', '## Unreleased', '- a', '## v1.0.0', '- b']);
    expect(range).toEqual({ start: 2, end: 4 });
  });

  it('spans to one past the last line when Unreleased is the final section', () => {
    const range = unreleasedLineRange(['## Unreleased', '- a', '- b']);
    expect(range).toEqual({ start: 1, end: 4 });
  });

  it('does not treat the Unreleased heading itself as the terminating section', () => {
    // A `>= start` bug would return end: 1; the next section is at index 2.
    const range = unreleasedLineRange(['## Unreleased', '- a', '## v2.0.0']);
    expect(range).toEqual({ start: 1, end: 3 });
  });
});
