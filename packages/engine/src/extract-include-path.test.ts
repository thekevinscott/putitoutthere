import { describe, expect, it } from 'vitest';

import { extractIncludePath } from './extract-include-path.js';

describe('extractIncludePath', () => {
  it('returns a string entry as-is', () => {
    expect(extractIncludePath('a/bin/*')).toBe('a/bin/*');
  });

  it('returns the `path` of an object entry', () => {
    expect(extractIncludePath({ path: 'a/bin', format: 'wheel' })).toBe('a/bin');
  });

  it('yields undefined for null, non-objects, and objects without a string `path`', () => {
    expect(extractIncludePath(null)).toBeUndefined();
    expect(extractIncludePath(42)).toBeUndefined();
    expect(extractIncludePath({ format: 'wheel' })).toBeUndefined();
    expect(extractIncludePath({ path: 7 })).toBeUndefined();
  });
});
