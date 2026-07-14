/**
 * Pins `extractHref`: reads the (case-insensitive) `href` attribute value from
 * double or single quotes, requires an attribute-name boundary (so `data-href`
 * is ignored), tolerates whitespace around `=`, returns the empty string for
 * an empty value, and returns null when there is no href.
 */

import { describe, expect, it } from 'vitest';

import { extractHref } from './extract-href.js';

describe('extractHref', () => {
  it('extracts a double-quoted href', () => {
    expect(extractHref('a href="https://x/foo-1.0.tar.gz#sha256=z"')).toBe('https://x/foo-1.0.tar.gz#sha256=z');
  });

  it('extracts a single-quoted href', () => {
    expect(extractHref("a href='rel/foo.tar.gz'")).toBe('rel/foo.tar.gz');
  });

  it('matches the href attribute name case-insensitively', () => {
    expect(extractHref('a HREF="up"')).toBe('up');
  });

  it('ignores data-href (no attribute-name boundary)', () => {
    expect(extractHref('a data-href="nope"')).toBeNull();
  });

  it('returns the empty string for an empty href value', () => {
    expect(extractHref('a href=""')).toBe('');
  });

  it('returns null when there is no href attribute', () => {
    expect(extractHref('a class="c"')).toBeNull();
  });

  it('rejects a leading href (an element name, not an attribute)', () => {
    expect(extractHref('href="x"')).toBeNull();
  });

  it('returns null when the href attribute has no value', () => {
    expect(extractHref('a href')).toBeNull();
  });

  it('returns null for an unquoted href value', () => {
    expect(extractHref('a href=unquoted')).toBeNull();
  });

  it('returns null for an unterminated quoted value', () => {
    expect(extractHref('a href="unterminated')).toBeNull();
  });
});
