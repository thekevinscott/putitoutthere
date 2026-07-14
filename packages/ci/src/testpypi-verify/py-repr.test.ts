/**
 * Pins that `pyRepr` reproduces CPython `repr` over this domain: single-quote
 * wrapping for strings, the bare literal `None` for null.
 */

import { describe, expect, it } from 'vitest';

import { pyRepr } from './py-repr.js';

describe('pyRepr', () => {
  it('wraps a version string in single quotes', () => {
    expect(pyRepr('1.0.0')).toBe("'1.0.0'");
  });

  it('renders null as the bare literal None', () => {
    expect(pyRepr(null)).toBe('None');
  });

  it('wraps the empty string in single quotes', () => {
    expect(pyRepr('')).toBe("''");
  });
});
