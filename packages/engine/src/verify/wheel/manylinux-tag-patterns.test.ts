import { describe, expect, it } from 'vitest';

import { manylinuxTagPatterns } from './manylinux-tag-patterns.js';

describe('manylinuxTagPatterns (#610)', () => {
  it('returns no patterns for auto / empty / undefined', () => {
    expect(manylinuxTagPatterns(undefined)).toEqual([]);
    expect(manylinuxTagPatterns('')).toEqual([]);
    expect(manylinuxTagPatterns('auto')).toEqual([]);
  });

  it('maps legacy aliases to alias + PEP 600 equivalents', () => {
    expect(manylinuxTagPatterns('1')).toEqual(['manylinux1_', 'manylinux_2_5_']);
    expect(manylinuxTagPatterns('2010')).toEqual(['manylinux2010_', 'manylinux_2_12_']);
    expect(manylinuxTagPatterns('2014')).toEqual(['manylinux2014_', 'manylinux_2_17_']);
  });

  it('maps a glibc baseline to its PEP 600 tag', () => {
    expect(manylinuxTagPatterns('2_28')).toEqual(['manylinux_2_28_']);
  });

  it('passes musllinux tags through', () => {
    expect(manylinuxTagPatterns('musllinux_1_2')).toEqual(['musllinux_1_2_']);
  });
});
