import { describe, expect, it } from 'vitest';

import { parsePackageList } from './parse-package-list.js';

describe('parsePackageList', () => {
  it('parses a well-formed list', () => {
    expect(parsePackageList('[a, b]')).toEqual(['a', 'b']);
  });

  it('trims whitespace around names', () => {
    expect(parsePackageList('[ a ,  b   , c ]')).toEqual(['a', 'b', 'c']);
  });

  it('accepts dots, underscores, hyphens and digits in names', () => {
    expect(parsePackageList('[my_pkg.v2, proj-2]')).toEqual(['my_pkg.v2', 'proj-2']);
  });

  it('parses an empty list as no packages', () => {
    expect(parsePackageList('[]')).toEqual([]);
    expect(parsePackageList('[  ]')).toEqual([]);
  });

  it('returns null for a string that does not open with `[`', () => {
    expect(parsePackageList('minor')).toBeNull();
    expect(parsePackageList('x[a]')).toBeNull();
  });

  it('returns null with no closing bracket', () => {
    expect(parsePackageList('[a, b')).toBeNull();
  });

  it('returns null for stray text after the closing bracket', () => {
    expect(parsePackageList('[a] oops')).toBeNull();
  });

  it('allows trailing whitespace after the closing bracket', () => {
    expect(parsePackageList('[a]  ')).toEqual(['a']);
  });

  it('returns null for an empty name', () => {
    expect(parsePackageList('[a,, b]')).toBeNull();
    expect(parsePackageList('[, a]')).toBeNull();
  });

  it('returns null for a name with disallowed characters', () => {
    expect(parsePackageList('[a b]')).toBeNull();
    expect(parsePackageList('[a/b]')).toBeNull();
    expect(parsePackageList('[a!]')).toBeNull();
    expect(parsePackageList('[-a]')).toBeNull();
  });
});
