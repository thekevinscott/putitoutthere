/**
 * Pins the exact HTML-whitespace set (space, tab, newline, carriage return)
 * and that ordinary characters are not whitespace.
 */

import { describe, expect, it } from 'vitest';

import { isHtmlSpace } from './is-html-space.js';

describe('isHtmlSpace', () => {
  it.each([' ', '\t', '\n', '\r'])('treats %j as whitespace', (ch) => {
    expect(isHtmlSpace(ch)).toBe(true);
  });

  it('treats a letter as non-whitespace', () => {
    expect(isHtmlSpace('a')).toBe(false);
  });

  it('treats a slash as non-whitespace', () => {
    expect(isHtmlSpace('/')).toBe(false);
  });
});
