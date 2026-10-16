/**
 * Coverage of every table cargo resolves is the contract: a stale version
 * requirement in ANY of them fails resolution identically (verified against
 * cargo 1.94.1), so a table missed here becomes an unbuildable tree at
 * release time.
 */

import { describe, expect, it } from 'vitest';

import { collectDepTables } from './collect-dep-tables.js';

describe('collectDepTables', () => {
  it('collects every dependency table cargo resolves', () => {
    expect(
      collectDepTables({
        dependencies: { a: 1 },
        'dev-dependencies': { b: 1 },
        'build-dependencies': { c: 1 },
        target: { 'cfg(unix)': { dependencies: { d: 1 } } },
        workspace: { dependencies: { e: 1 } },
      }),
    ).toEqual([{ a: 1 }, { b: 1 }, { c: 1 }, { d: 1 }, { e: 1 }]);
  });

  it('collects target-specific dev and build tables too', () => {
    expect(
      collectDepTables({
        target: {
          'cfg(windows)': {
            'dev-dependencies': { a: 1 },
            'build-dependencies': { b: 1 },
          },
        },
      }),
    ).toEqual([{ a: 1 }, { b: 1 }]);
  });

  it('ignores dependency tables that are not objects', () => {
    expect(collectDepTables({ dependencies: 'nonsense', target: 'nonsense' })).toEqual([]);
  });

  it('ignores a target entry that is not an object', () => {
    expect(collectDepTables({ target: { 'cfg(unix)': 'nonsense' } })).toEqual([]);
  });

  // `typeof null === "object"`, so every table guard needs an explicit null
  // arm or the walk reaches a property read on null and throws. Each case
  // below is a distinct guard.
  it('ignores a null dependency table', () => {
    expect(collectDepTables({ dependencies: null })).toEqual([]);
  });

  it('ignores a null target table', () => {
    expect(collectDepTables({ target: null })).toEqual([]);
  });

  it('ignores a null entry under target', () => {
    expect(collectDepTables({ target: { 'cfg(unix)': null } })).toEqual([]);
  });

  it('ignores a null workspace table', () => {
    expect(collectDepTables({ workspace: null })).toEqual([]);
  });

  it('ignores a null workspace dependencies table', () => {
    expect(collectDepTables({ workspace: { dependencies: null } })).toEqual([]);
  });

  it('returns nothing for a manifest with no dependencies', () => {
    expect(collectDepTables({ package: { name: 'x', version: '1.0.0' } })).toEqual([]);
  });
});
