import { afterEach, describe, expect, it, vi } from 'vitest';

import { jitterOffset } from './jitter-offset.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('jitterOffset', () => {
  it('applies no offset when fraction is 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(jitterOffset(1000, 0)).toBeCloseTo(0);
  });

  it.each([
    [0, -250],
    [0.5, 0],
    [0.75, 125],
  ])('maps Math.random() %d to an offset of %d', (random, offset) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    expect(jitterOffset(1000, 0.25)).toBe(offset);
  });
});
