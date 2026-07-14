/**
 * Pins which trimmed added lines the patch-coverage gate (#468) treats as
 * non-statements and skips (they carry no v8-instrumented statement, so
 * demanding coverage of them would be a false positive). Reproduces the
 * `.mjs`'s skip chain applied to `text.trim()`:
 *   - empty line,
 *   - `//` line comment,
 *   - `/*` block-comment open,
 *   - `*` block-comment continuation,
 *   - pure punctuation (`}`, `});`, …).
 * Pure; exact boolean assertions.
 */

import { describe, expect, it } from 'vitest';

import { isNonStatementLine } from './is-non-statement-line.js';

describe('isNonStatementLine', () => {
  it('skips an empty (blank) line', () => {
    expect(isNonStatementLine('')).toBe(true);
  });

  it('skips a // line comment', () => {
    expect(isNonStatementLine('// a comment')).toBe(true);
  });

  it('skips a /* block-comment opener', () => {
    expect(isNonStatementLine('/* opening')).toBe(true);
  });

  it('skips a * block-comment continuation', () => {
    expect(isNonStatementLine('* jsdoc line')).toBe(true);
  });

  it('skips a */ block-comment closer (starts with *)', () => {
    expect(isNonStatementLine('*/')).toBe(true);
  });

  it('skips a pure-punctuation closer', () => {
    expect(isNonStatementLine('});')).toBe(true);
  });

  it('does NOT skip a real statement', () => {
    expect(isNonStatementLine('const a = 1;')).toBe(false);
  });

  it('does NOT skip a single-slash division expression', () => {
    expect(isNonStatementLine('const half = x / 2;')).toBe(false);
  });

  it('does NOT skip a statement that merely contains a comment marker', () => {
    expect(isNonStatementLine('doThing(); // trailing note')).toBe(false);
  });
});
