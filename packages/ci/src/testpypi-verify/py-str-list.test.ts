/**
 * Pins that `pyStrList` reproduces CPython's `repr` of a list of strings:
 * bracket-wrapped, comma-space separated, each element single-quoted.
 */

import { describe, expect, it } from 'vitest';

import { pyStrList } from './py-str-list.js';

describe('pyStrList', () => {
  it('renders the empty list as []', () => {
    expect(pyStrList([])).toBe('[]');
  });

  it('renders a single element with repr quoting', () => {
    expect(pyStrList(['1.0.0'])).toBe("['1.0.0']");
  });

  it('joins multiple elements with a comma and a space', () => {
    expect(pyStrList(['a', 'b'])).toBe("['a', 'b']");
  });
});
