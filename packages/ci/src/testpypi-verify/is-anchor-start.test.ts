/**
 * Pins `isAnchorStart`: matches `<a>` (case-insensitively, with or without
 * attributes), treats whitespace and `/` as the tag-name boundary, and rejects
 * close tags and other element names.
 */

import { describe, expect, it } from 'vitest';

import { isAnchorStart } from './is-anchor-start.js';

describe('isAnchorStart', () => {
  it('matches a lowercase anchor start tag with attributes', () => {
    expect(isAnchorStart('a href="x"')).toBe(true);
  });

  it('matches an uppercase anchor tag case-insensitively', () => {
    expect(isAnchorStart('A HREF="x"')).toBe(true);
  });

  it('matches a bare anchor tag', () => {
    expect(isAnchorStart('a')).toBe(true);
  });

  it('rejects a close tag', () => {
    expect(isAnchorStart('/a')).toBe(false);
  });

  it('rejects an element whose name merely starts with "a"', () => {
    expect(isAnchorStart('area href="x"')).toBe(false);
  });

  it('rejects a different element', () => {
    expect(isAnchorStart('br')).toBe(false);
  });

  it('treats a tab as the tag-name boundary', () => {
    expect(isAnchorStart('a\thref="x"')).toBe(true);
  });

  it('treats a slash as the tag-name boundary (self-closing)', () => {
    expect(isAnchorStart('a/')).toBe(true);
  });

  it('takes the earliest boundary when the href value contains slashes', () => {
    expect(isAnchorStart('a href="https://files/foo.tar.gz"')).toBe(true);
  });
});
