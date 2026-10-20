import { describe, expect, it } from 'vitest';

import { expandRequiresPython } from './expand-requires-python.js';

describe('expandRequiresPython', () => {
  it('expands `>=3.10` to the released CPython set it allows', () => {
    expect(expandRequiresPython('>=3.10')).toEqual([
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('includes the latest released CPython for open-ended lower bounds (#375)', () => {
    expect(expandRequiresPython('>=3.11')).toContain('3.14');
  });

  it('honours an upper bound', () => {
    expect(expandRequiresPython('>=3.9,<3.12')).toEqual(['3.9', '3.10', '3.11']);
  });

  it('treats `<3.12` as exclusive', () => {
    expect(expandRequiresPython('>=3.11,<3.12')).toEqual(['3.11']);
  });

  it('handles a `~=` compatible-release clause', () => {
    expect(expandRequiresPython('~=3.11')).toEqual(['3.11', '3.12', '3.13', '3.14']);
  });

  it('handles an exact `==` pin', () => {
    expect(expandRequiresPython('==3.12')).toEqual(['3.12']);
  });

  it('handles the arbitrary-equality `===` operator', () => {
    expect(expandRequiresPython('===3.12')).toEqual(['3.12']);
  });

  it('handles exclusive `>` and inclusive `<=` bounds', () => {
    expect(expandRequiresPython('>3.11,<=3.13')).toEqual(['3.12', '3.13']);
  });

  it('handles a `!=` exclusion', () => {
    expect(expandRequiresPython('>=3.10,!=3.12')).toEqual([
      '3.10',
      '3.11',
      '3.13',
      '3.14',
    ]);
  });

  it('handles an `==3.*` wildcard', () => {
    expect(expandRequiresPython('==3.*')).toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('tolerates a patch component in the spec version', () => {
    expect(expandRequiresPython('>=3.11.0')).toEqual(['3.11', '3.12', '3.13', '3.14']);
  });

  it('tolerates a bare-major spec version', () => {
    expect(expandRequiresPython('>=3')).toEqual([
      '3.8',
      '3.9',
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('tolerates whitespace and a `<4` major bound', () => {
    expect(expandRequiresPython('>= 3.10, < 4')).toEqual([
      '3.10',
      '3.11',
      '3.12',
      '3.13',
      '3.14',
    ]);
  });

  it('returns an empty array for an unparseable spec', () => {
    expect(expandRequiresPython('not-a-version')).toEqual([]);
  });

  it('returns an empty array for an empty spec', () => {
    expect(expandRequiresPython('')).toEqual([]);
  });
});
