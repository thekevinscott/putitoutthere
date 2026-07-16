/**
 * Pins `hasIgnoreReason`, the patch-coverage gate's documented-marker detector.
 * A marker earns permission only when a non-whitespace reason follows the `--`
 * separator (a trailing `-- why` on a v8/c8 ignore marker); a bare marker does
 * not. Inputs are chosen to kill each fixed-string mutant on the one-line
 * implementation: the `--` and comment-close split literals, the `slice(1)` /
 * `join('--')` reassembly, the first-segment pick, `trim()`, and `length > 0`.
 */

import { describe, expect, it } from 'vitest';

import { hasIgnoreReason } from './has-ignore-reason.js';

describe('hasIgnoreReason', () => {
  it('is false for a bare marker with no reason separator', () => {
    expect(hasIgnoreReason('/* v8 ignore next */')).toBe(false);
  });

  it('is false for an ordinary comment with no separator', () => {
    expect(hasIgnoreReason('/* a normal comment */')).toBe(false);
  });

  it('is true for a single-character reason (pins the length > 0 boundary)', () => {
    expect(hasIgnoreReason('/* v8 ignore next -- x */')).toBe(true);
  });

  it('is true for a multi-word reason', () => {
    expect(hasIgnoreReason('/* v8 ignore next -- Zod defaults this to [] */')).toBe(true);
  });

  it('is false when the separator is present but the reason is empty', () => {
    expect(hasIgnoreReason('/* v8 ignore next -- */')).toBe(false);
  });

  it('is false when the reason is only whitespace (pins trim)', () => {
    expect(hasIgnoreReason('/* v8 ignore next --    */')).toBe(false);
  });

  it('reassembles a reason that itself contains the separator', () => {
    // The reason text is `--`; the join('--') must put it back, not drop it.
    expect(hasIgnoreReason('/* v8 ignore next -- -- */')).toBe(true);
  });

  it('keeps a reason with an embedded double-dash intact', () => {
    expect(hasIgnoreReason('/* v8 ignore next -- a--b */')).toBe(true);
  });

  it('ignores text after the block-comment close', () => {
    // Everything at or after the close is outside the reason; a reason before it counts.
    expect(hasIgnoreReason('/* v8 ignore next -- real */ code')).toBe(true);
  });
});
