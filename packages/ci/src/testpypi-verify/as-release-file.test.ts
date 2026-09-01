/**
 * Pins the narrowing of one `urls` entry: both fields present as strings, or
 * `null`. Everything downstream writes to `filename` and fetches `url`, so a
 * missing or wrongly-typed field must not reach it.
 */

import { describe, expect, it } from 'vitest';

import { asReleaseFile } from './as-release-file.js';

describe('asReleaseFile', () => {
  it('keeps the filename and url, dropping every other field', () => {
    expect(asReleaseFile({ filename: 'x-1.whl', url: 'https://f/x-1.whl', packagetype: 'bdist_wheel', size: 12 })).toEqual({
      filename: 'x-1.whl',
      url: 'https://f/x-1.whl',
    });
  });

  it.each([
    ['a non-object', 'x-1.whl'],
    ['null', null],
    ['a missing url', { filename: 'x-1.whl' }],
    ['a missing filename', { url: 'https://f/x-1.whl' }],
    ['a non-string url', { filename: 'x-1.whl', url: 42 }],
    ['a non-string filename', { filename: 42, url: 'https://f/x-1.whl' }],
  ])('rejects %s', (_label, entry) => {
    expect(asReleaseFile(entry)).toBeNull();
  });
});
