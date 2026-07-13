/**
 * Pins `unquote`: identity for unencoded input, `%XX`/UTF-8 decoding, and
 * lenient pass-through of malformed percent input.
 */

import { describe, expect, it } from 'vitest';

import { unquote } from './unquote.js';

describe('unquote', () => {
  it('returns an unencoded string unchanged', () => {
    expect(unquote('foo-1.0.tar.gz')).toBe('foo-1.0.tar.gz');
  });

  it('decodes a percent-encoded byte', () => {
    expect(unquote('a%2Bb')).toBe('a+b');
  });

  it('decodes a UTF-8 sequence', () => {
    expect(unquote('%E2%9C%93')).toBe('✓');
  });

  it('returns malformed percent input unchanged', () => {
    expect(unquote('bad%')).toBe('bad%');
  });
});
