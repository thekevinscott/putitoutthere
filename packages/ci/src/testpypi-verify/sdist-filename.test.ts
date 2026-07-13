/**
 * Pins `sdistFilenameFromHref`: last path segment after stripping fragment and
 * query, works for absolute and relative hrefs, percent-decodes, and returns
 * the whole string when there is no slash.
 */

import { describe, expect, it } from 'vitest';

import { sdistFilenameFromHref } from './sdist-filename.js';

describe('sdistFilenameFromHref', () => {
  it('takes the last path segment and strips the fragment', () => {
    expect(sdistFilenameFromHref('https://x/a/b/foo-1.0.tar.gz#sha256=z')).toBe('foo-1.0.tar.gz');
  });

  it('handles a relative href', () => {
    expect(sdistFilenameFromHref('../../packages/aa/foo-1.0.tar.gz#h')).toBe('foo-1.0.tar.gz');
  });

  it('strips a query string', () => {
    expect(sdistFilenameFromHref('x/foo.tar.gz?k=v')).toBe('foo.tar.gz');
  });

  it('percent-decodes the filename', () => {
    expect(sdistFilenameFromHref('x/foo%2B1.tar.gz')).toBe('foo+1.tar.gz');
  });

  it('returns the whole string when there is no slash', () => {
    expect(sdistFilenameFromHref('foo.tar.gz')).toBe('foo.tar.gz');
  });
});
