import { describe, expect, it } from 'vitest';

import { mustGet } from './must-get.js';

describe('mustGet', () => {
  it('returns the value stored under a present key', () => {
    const map = new Map<string, number[]>([
      ['a', [1, 2]],
      ['b', []],
    ]);
    // A seeded key returns its value by reference — including a legitimately
    // empty array, which must not be conflated with "absent".
    expect(mustGet(map, 'a', 'lookup')).toEqual([1, 2]);
    expect(mustGet(map, 'b', 'lookup')).toEqual([]);
  });

  it('throws a labelled error naming the missing key', () => {
    const map = new Map<string, number>([['a', 1]]);
    // The whole point of the helper: a broken seeding invariant becomes a
    // diagnosable throw (label + key) instead of an unreachable `?? default`
    // branch the coverage floor can never exercise.
    expect(() => mustGet(map, 'missing', 'publish: unknown package')).toThrow(
      'publish: unknown package: missing',
    );
  });
});
