import { describe, expect, it } from 'vitest';

import { formatScalar } from './format-scalar.js';

describe('formatScalar', () => {
  it('returns strings unquoted', () => {
    expect(formatScalar('a b')).toBe('a b');
  });

  it('stringifies numbers, including non-finite ones', () => {
    expect(formatScalar(3)).toBe('3');
    expect(formatScalar(Number.NaN)).toBe('NaN');
    expect(formatScalar(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });

  it('stringifies booleans and null', () => {
    expect(formatScalar(true)).toBe('true');
    expect(formatScalar(null)).toBe('null');
  });

  it('JSON-encodes objects', () => {
    expect(formatScalar({ a: 1 })).toBe('{"a":1}');
  });
});
