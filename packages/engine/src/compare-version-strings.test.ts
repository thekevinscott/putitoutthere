import { describe, expect, it } from 'vitest';

import { compareVersionStrings } from './compare-version-strings.js';

describe('compareVersionStrings', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersionStrings('3.9', '3.13')).toBe(-1);
    expect(compareVersionStrings('3.13', '3.9')).toBe(1);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersionStrings('3.12', '3.12')).toBe(0);
  });
});
