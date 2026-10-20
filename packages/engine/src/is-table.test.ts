import { describe, expect, it } from 'vitest';

import { isTable } from './is-table.js';

describe('isTable', () => {
  it('accepts a plain object', () => {
    expect(isTable({ a: 1 })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isTable(value)).toBe(false);
  });
});
