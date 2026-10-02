/**
 * Pins the pure-punctuation test the patch-coverage gate (#468) uses to skip
 * lines v8 never instruments, reproducing the `.mjs`'s
 * `/^[(){}\[\];,]+$/.test(trimmed)`. An explicit character-set check, not a
 * regex quantifier, so the one-or-more semantics need an exact empty-string case.
 */

import { describe, expect, it } from 'vitest';

import { isPurePunctuation } from './is-pure-punctuation.js';

describe('isPurePunctuation', () => {
  it('is true for a closing brace', () => {
    expect(isPurePunctuation('}')).toBe(true);
  });

  it('is true for a });  closer', () => {
    expect(isPurePunctuation('});')).toBe(true);
  });

  it('is true for every accepted punctuation character together', () => {
    expect(isPurePunctuation('(){}[];,')).toBe(true);
  });

  it('is false for the empty string (matching the regex + one-or-more)', () => {
    expect(isPurePunctuation('')).toBe(false);
  });

  it('is false when any non-punctuation character is present', () => {
    expect(isPurePunctuation('a);')).toBe(false);
  });

  it('is false for whitespace mixed with punctuation', () => {
    expect(isPurePunctuation('} ')).toBe(false);
  });

  it('is false for an ordinary statement', () => {
    expect(isPurePunctuation('return x;')).toBe(false);
  });
});
