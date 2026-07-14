/**
 * Pins the strict-100% escape-hatch detector for the patch-coverage gate
 * (#468). Reproduces the `.mjs`'s
 * `HATCH_RE = /\/\*\s*(?:v8|c8|istanbul)\s+ignore/i` — a `/*`, optional
 * whitespace, one of v8|c8|istanbul, at least one whitespace, then `ignore`,
 * case-insensitive, matched anywhere in the added line's text. Pure; exact
 * boolean assertions, with inputs chosen to pin the `\s*` (zero-or-more,
 * before the tool name) vs `\s+` (one-or-more, before `ignore`) boundary.
 */

import { describe, expect, it } from 'vitest';

import { isEscapeHatch } from './is-escape-hatch.js';

describe('isEscapeHatch', () => {
  it('matches the canonical v8 ignore marker', () => {
    expect(isEscapeHatch('  /* v8 ignore next */')).toBe(true);
  });

  it('matches c8 and istanbul dialects', () => {
    expect(isEscapeHatch('/* c8 ignore next */')).toBe(true);
    expect(isEscapeHatch('/* istanbul ignore next */')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isEscapeHatch('/* V8 IGNORE next */')).toBe(true);
  });

  it('matches with no whitespace between /* and the tool name (\\s* is zero-or-more)', () => {
    expect(isEscapeHatch('/*v8 ignore*/')).toBe(true);
  });

  it('matches with extra whitespace between /* and the tool name', () => {
    expect(isEscapeHatch('/*   v8 ignore */')).toBe(true);
  });

  it('requires at least one whitespace before "ignore" (\\s+ is one-or-more)', () => {
    expect(isEscapeHatch('/* v8ignore */')).toBe(false);
  });

  it('matches with multiple whitespace before "ignore" (\\s+, not exactly one \\s)', () => {
    expect(isEscapeHatch('/* v8  ignore */')).toBe(true);
  });

  it('does not match an ordinary comment', () => {
    expect(isEscapeHatch('/* a normal comment */')).toBe(false);
  });

  it('does not match code that merely mentions ignore', () => {
    expect(isEscapeHatch('const ignore = true;')).toBe(false);
  });

  it('does not match a v8 mention without the /* block-comment opener', () => {
    expect(isEscapeHatch('// v8 ignore next')).toBe(false);
  });
});
