import { describe, expect, it } from 'vitest';

import { tableAt } from './table-at.js';

describe('tableAt', () => {
  it('returns the nested table at the path', () => {
    expect(tableAt({ tool: { maturin: { bindings: 'bin' } } }, ['tool', 'maturin'])).toEqual({
      bindings: 'bin',
    });
  });

  it('returns null for a null root', () => {
    expect(tableAt(null, ['tool'])).toBeNull();
  });

  it('returns null when an intermediate key is missing', () => {
    expect(tableAt({ project: {} }, ['tool', 'maturin'])).toBeNull();
  });

  it('returns null when an intermediate value is not a table', () => {
    expect(tableAt({ tool: 'nope' }, ['tool', 'maturin'])).toBeNull();
  });

  it('does not walk into an array', () => {
    expect(tableAt({ tool: [{ a: 1 }] }, ['tool', '0'])).toBeNull();
  });

  it('returns null when the path bottoms out on a non-table value', () => {
    expect(tableAt({ tool: { maturin: 'not-a-table' } }, ['tool', 'maturin'])).toBeNull();
  });
});
