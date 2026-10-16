/**
 * Unit tests for `cargoDepEntries` (#621).
 */

import { describe, expect, it } from 'vitest';

import { cargoDepEntries } from './cargo-dep-entries.js';

describe('cargoDepEntries', () => {
  it('flattens entries across every dependency table', () => {
    expect(
      cargoDepEntries({
        dependencies: { a: { path: '../a' }, serde: '1' },
        target: { 'cfg(unix)': { dependencies: { d: { workspace: true } } } },
      }),
    ).toEqual([
      { key: 'a', path: '../a', hasVersionReq: false, inheritsFromWorkspace: false },
      { key: 'serde', hasVersionReq: true, inheritsFromWorkspace: false },
      { key: 'd', path: undefined, hasVersionReq: false, inheritsFromWorkspace: true },
    ]);
  });

  it('returns nothing for a non-object input', () => {
    expect(cargoDepEntries(null)).toEqual([]);
    expect(cargoDepEntries('not a manifest')).toEqual([]);
  });
});
