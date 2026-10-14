import { describe, expect, it } from 'vitest';

import { nonEmptyString } from './non-empty-string.js';

describe('nonEmptyString', () => {
  it('accepts a string with non-whitespace content', () => {
    expect(nonEmptyString(' MIT ')).toBe(true);
  });

  it('rejects empty, whitespace-only and non-string values', () => {
    expect(nonEmptyString('')).toBe(false);
    expect(nonEmptyString('   ')).toBe(false);
    expect(nonEmptyString(undefined)).toBe(false);
    expect(nonEmptyString({ workspace: true })).toBe(false);
  });
});
