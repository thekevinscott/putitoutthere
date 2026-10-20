import { describe, expect, it } from 'vitest';

import { greater } from './greater.js';

const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });

describe('greater', () => {
  it('compares by major first, ignoring minor and patch', () => {
    expect(greater(v(2, 0, 0), v(1, 9, 9))).toBe(true);
    expect(greater(v(1, 9, 9), v(2, 0, 0))).toBe(false);
  });

  it('compares by minor when majors match, ignoring patch', () => {
    expect(greater(v(1, 4, 0), v(1, 3, 9))).toBe(true);
    expect(greater(v(1, 3, 9), v(1, 4, 0))).toBe(false);
  });

  it('compares by patch when major and minor match', () => {
    expect(greater(v(1, 2, 4), v(1, 2, 3))).toBe(true);
    expect(greater(v(1, 2, 3), v(1, 2, 4))).toBe(false);
  });

  it('is false for equal versions', () => {
    expect(greater(v(1, 2, 3), v(1, 2, 3))).toBe(false);
  });
});
