/**
 * Pins `findSdistHref`: returns the first href whose filename ends with the
 * expected suffix, and null when none match.
 */

import { describe, expect, it } from 'vitest';

import { findSdistHref } from './find-sdist-href.js';

describe('findSdistHref', () => {
  it('returns the first href whose filename ends with the suffix', () => {
    expect(
      findSdistHref(['https://x/foo-1.0-py3-none-any.whl#a', 'https://x/foo-1.0.tar.gz#b'], '-1.0.tar.gz'),
    ).toBe('https://x/foo-1.0.tar.gz#b');
  });

  it('returns null when no filename matches', () => {
    expect(findSdistHref(['https://x/foo-2.0.tar.gz'], '-1.0.tar.gz')).toBeNull();
  });

  it('returns the first of several matches', () => {
    expect(findSdistHref(['https://x/a/foo-1.0.tar.gz#1', 'https://y/foo-1.0.tar.gz#2'], '-1.0.tar.gz')).toBe(
      'https://x/a/foo-1.0.tar.gz#1',
    );
  });
});
