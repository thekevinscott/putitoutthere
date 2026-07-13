import { describe, expect, it } from 'vitest';

import { parseHunkHeader } from './parse-hunk-header.js';

describe('parseHunkHeader', () => {
  it('returns the new-file start line from a full hunk header', () => {
    expect(parseHunkHeader('@@ -12,3 +45,6 @@ context')).toBe(45);
  });

  it('parses multi-digit numbers in every field', () => {
    // Guards the `\d+` quantifiers: a `\d`-shrink would misparse these.
    expect(parseHunkHeader('@@ -12,20 +30,40 @@')).toBe(30);
  });

  it('parses a hunk header with no line counts (single-line ranges)', () => {
    // Guards the optional `(?:,\d+)?` groups against becoming required.
    expect(parseHunkHeader('@@ -1 +2 @@')).toBe(2);
  });

  it('parses when only the old range omits its count', () => {
    expect(parseHunkHeader('@@ -5 +7,2 @@')).toBe(7);
  });

  it('parses when only the new range omits its count', () => {
    expect(parseHunkHeader('@@ -5,2 +7 @@')).toBe(7);
  });

  it('returns null for an added content line', () => {
    expect(parseHunkHeader('+- a new bullet')).toBeNull();
  });

  it('returns null for an unrelated line', () => {
    expect(parseHunkHeader('not a hunk header')).toBeNull();
  });

  it('returns null when the header prefix is wrong', () => {
    expect(parseHunkHeader('@@@ -1 +2 @@')).toBeNull();
  });
});
