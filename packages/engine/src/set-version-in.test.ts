import { describe, expect, it } from 'vitest';

import { setVersionIn } from './set-version-in.js';

describe('setVersionIn', () => {
  it('replaces a spaced version value', () => {
    expect(setVersionIn('version = "0.2"', '0.4.2')).toBe('version = "0.4.2"');
  });

  it('replaces a version value written without spaces', () => {
    expect(setVersionIn('version="0.2"', '0.4.2')).toBe('version="0.4.2"');
  });

  it('replaces a version value padded with tabs', () => {
    expect(setVersionIn('version\t=\t"0.2"', '0.4.2')).toBe('version\t=\t"0.4.2"');
  });

  it('replaces only the first version value', () => {
    expect(setVersionIn('version = "0.2"\nversion = "0.3"\n', '0.4.2')).toBe(
      'version = "0.4.2"\nversion = "0.3"\n',
    );
  });

  it('does not match a key that merely ends in "version"', () => {
    expect(setVersionIn('pkgversion = "1"\nversion = "0.2"', '0.4.2')).toBe(
      'pkgversion = "1"\nversion = "0.4.2"',
    );
  });

  it('replaces an empty version value', () => {
    expect(setVersionIn('version = ""', '0.4.2')).toBe('version = "0.4.2"');
  });

  it('leaves a segment with no version key untouched', () => {
    expect(setVersionIn('path = "../core"', '0.4.2')).toBe('path = "../core"');
  });
});
