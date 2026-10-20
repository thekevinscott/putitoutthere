import { describe, expect, it } from 'vitest';

import { compareVersionTuples } from './compare-version-tuples.js';

describe('compareVersionTuples', () => {
  it('returns 0 for equal tuples', () => {
    expect(compareVersionTuples([3, 10], [3, 10])).toBe(0);
  });

  it('zero-pads the shorter tuple', () => {
    expect(compareVersionTuples([3, 10], [3, 10, 0])).toBe(0);
    expect(compareVersionTuples([3, 10], [3, 10, 1])).toBe(-1);
    expect(compareVersionTuples([3, 10, 1], [3, 10])).toBe(1);
  });

  it('orders by the first differing component, numerically', () => {
    expect(compareVersionTuples([3, 9], [3, 10])).toBe(-1);
    expect(compareVersionTuples([3, 10], [3, 9])).toBe(1);
    expect(compareVersionTuples([4, 0], [3, 14])).toBe(1);
  });

  it('treats a non-numeric component as greater', () => {
    expect(compareVersionTuples([3, Number.NaN], [3, 10])).toBe(1);
    expect(compareVersionTuples([3, 10], [3, Number.NaN])).toBe(1);
  });
});
