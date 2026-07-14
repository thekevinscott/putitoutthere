/**
 * Pins `selectPkgInfoMember`: the first member ending `/PKG-INFO` wins; an
 * empty match yields the exact `no PKG-INFO file …` error.
 */

import { describe, expect, it } from 'vitest';

import { selectPkgInfoMember } from './select-pkginfo-member.js';

describe('selectPkgInfoMember', () => {
  it('selects the first PKG-INFO member', () => {
    expect(selectPkgInfoMember(['foo-1.0/setup.py', 'foo-1.0/PKG-INFO'], 'foo-1.0.tar.gz')).toEqual({
      member: 'foo-1.0/PKG-INFO',
    });
  });

  it('selects the first of several PKG-INFO members', () => {
    expect(selectPkgInfoMember(['a/PKG-INFO', 'b/PKG-INFO'], 'foo.tar.gz')).toEqual({ member: 'a/PKG-INFO' });
  });

  it('errors when no PKG-INFO member exists', () => {
    expect(selectPkgInfoMember(['foo-1.0/setup.py'], 'foo-1.0.tar.gz')).toEqual({
      errorLine: 'no PKG-INFO file in foo-1.0.tar.gz',
    });
  });
});
