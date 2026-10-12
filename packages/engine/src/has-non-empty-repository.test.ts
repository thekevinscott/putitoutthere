import { describe, expect, it } from 'vitest';

import { hasNonEmptyRepository } from './has-non-empty-repository.js';

describe('hasNonEmptyRepository', () => {
  it('accepts a non-blank string or an object with a non-blank url', () => {
    expect(hasNonEmptyRepository('git+https://github.com/x/y.git')).toBe(true);
    expect(hasNonEmptyRepository({ type: 'git', url: ' https://github.com/x/y ' })).toBe(true);
  });

  it('rejects blank strings, url-less or blank-url objects, null and other types', () => {
    expect(hasNonEmptyRepository('')).toBe(false);
    expect(hasNonEmptyRepository('   ')).toBe(false);
    expect(hasNonEmptyRepository({ type: 'git' })).toBe(false);
    expect(hasNonEmptyRepository({ url: '  ' })).toBe(false);
    expect(hasNonEmptyRepository({ url: 42 })).toBe(false);
    expect(hasNonEmptyRepository(null)).toBe(false);
    expect(hasNonEmptyRepository(undefined)).toBe(false);
    expect(hasNonEmptyRepository(7)).toBe(false);
  });
});
