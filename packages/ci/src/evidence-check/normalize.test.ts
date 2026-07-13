import { describe, expect, it } from 'vitest';

import { normalize } from './normalize.js';

describe('normalize', () => {
  it('lowercases and slashes separators', () => {
    expect(normalize('e2e/js-vanilla')).toBe('e2e/js/vanilla');
  });

  it('collapses each run of non-alphanumerics to a single slash', () => {
    // Guards the `+` in `[^a-z0-9]+`: a shrink to one char would emit `a//b`.
    expect(normalize('a  b')).toBe('a/b');
  });

  it('strips a leading and trailing separator', () => {
    expect(normalize('-a-')).toBe('a');
  });

  it('lowercases uppercase input', () => {
    expect(normalize('Unit (ubuntu-latest)')).toBe('unit/ubuntu/latest');
  });

  it('returns an empty string for null', () => {
    expect(normalize(null)).toBe('');
  });

  it('returns an empty string for undefined', () => {
    expect(normalize(undefined)).toBe('');
  });

  it('passes through an already-normal slug', () => {
    expect(normalize('integration')).toBe('integration');
  });
});
