import { describe, expect, it } from 'vitest';

import { satisfiesClause } from './satisfies-clause.js';

describe('satisfiesClause', () => {
  it.each([
    ['>=', '3.11', [3, 11], true],
    ['>=', '3.11', [3, 10], false],
    ['>', '3.11', [3, 11], false],
    ['>', '3.11', [3, 12], true],
    ['<=', '3.13', [3, 13], true],
    ['<=', '3.13', [3, 14], false],
    ['<', '3.12', [3, 12], false],
    ['<', '3.12', [3, 11], true],
    ['~=', '3.11', [3, 12], true],
    ['~=', '3.11', [3, 10], false],
    ['~=', '3.11', [4, 0], false],
    ['==', '3.12', [3, 12], true],
    ['==', '3.12', [3, 13], false],
    ['==', '3.*', [3, 9], true],
    ['==', '3.*', [4, 0], false],
    ['===', '3', [3, 11], true],
    ['===', '3.12', [3, 13], false],
    ['!=', '3', [3, 11], false],
    ['!=', '3.12', [3, 13], true],
  ] as const)('%s%s against %j is %s', (op, version, candidate, expected) => {
    expect(satisfiesClause(candidate, { op, version })).toBe(expected);
  });
});
