import { describe, expect, it } from 'vitest';

import { parseSpecifierClauses } from './parse-specifier-clauses.js';

describe('parseSpecifierClauses', () => {
  it('reads each comma-separated clause', () => {
    expect(parseSpecifierClauses('>=3.9,<3.12')).toEqual([
      { op: '>=', version: '3.9' },
      { op: '<', version: '3.12' },
    ]);
  });

  it('prefers the longest operator', () => {
    expect(parseSpecifierClauses('===3.12')).toEqual([{ op: '===', version: '3.12' }]);
    expect(parseSpecifierClauses('<=3.13')).toEqual([{ op: '<=', version: '3.13' }]);
    expect(parseSpecifierClauses('~=3.11')).toEqual([{ op: '~=', version: '3.11' }]);
    expect(parseSpecifierClauses('!=3.12')).toEqual([{ op: '!=', version: '3.12' }]);
  });

  it('keeps a trailing wildcard', () => {
    expect(parseSpecifierClauses('==3.*')).toEqual([{ op: '==', version: '3.*' }]);
  });

  it('tolerates whitespace between operator and version', () => {
    expect(parseSpecifierClauses('>= 3.10, < 4')).toEqual([
      { op: '>=', version: '3.10' },
      { op: '<', version: '4' },
    ]);
  });

  it('returns no clauses for an unparseable spec', () => {
    expect(parseSpecifierClauses('not-a-version')).toEqual([]);
    expect(parseSpecifierClauses('')).toEqual([]);
  });
});
