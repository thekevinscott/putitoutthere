import { describe, expect, it } from 'vitest';

import { isWithinRange } from './is-within-range.js';

const range = { start: 2, end: 5 };

describe('isWithinRange', () => {
  it('includes a line in the middle of the range', () => {
    expect(isWithinRange(3, range)).toBe(true);
  });

  it('includes the inclusive start bound', () => {
    expect(isWithinRange(2, range)).toBe(true);
  });

  it('excludes a line just before the start', () => {
    expect(isWithinRange(1, range)).toBe(false);
  });

  it('excludes the exclusive end bound', () => {
    expect(isWithinRange(5, range)).toBe(false);
  });

  it('excludes a line past the end', () => {
    expect(isWithinRange(6, range)).toBe(false);
  });
});
