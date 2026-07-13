/**
 * Pins `normalizeIndexUrl` = `rstrip("/") + "/"`: keep a single trailing slash,
 * add one when missing, and collapse several to one.
 */

import { describe, expect, it } from 'vitest';

import { normalizeIndexUrl } from './normalize-index-url.js';

describe('normalizeIndexUrl', () => {
  it('leaves a single trailing slash intact', () => {
    expect(normalizeIndexUrl('https://test.pypi.org/simple/')).toBe('https://test.pypi.org/simple/');
  });

  it('adds a trailing slash when missing', () => {
    expect(normalizeIndexUrl('https://test.pypi.org/simple')).toBe('https://test.pypi.org/simple/');
  });

  it('collapses multiple trailing slashes to one', () => {
    expect(normalizeIndexUrl('https://test.pypi.org/simple//')).toBe('https://test.pypi.org/simple/');
  });
});
