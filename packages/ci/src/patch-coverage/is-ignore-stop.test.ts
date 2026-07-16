/**
 * Pins `isIgnoreStop`, the patch-coverage gate's closer detector. A `stop`/`end`
 * closer is permitted without a reason; a `next`/`start` opener is not a closer
 * and still must justify itself. Inputs pin both `includes` literals, the `||`,
 * and the case-fold.
 */

import { describe, expect, it } from 'vitest';

import { isIgnoreStop } from './is-ignore-stop.js';

describe('isIgnoreStop', () => {
  it('is true for a bare v8 ignore stop closer', () => {
    expect(isIgnoreStop('/* v8 ignore stop */')).toBe(true);
  });

  it('is true for an ignore end closer (istanbul dialect)', () => {
    expect(isIgnoreStop('/* c8 ignore end */')).toBe(true);
  });

  it('is case-insensitive (pins the case-fold)', () => {
    expect(isIgnoreStop('/* V8 IGNORE STOP */')).toBe(true);
  });

  it('is false for a next opener', () => {
    expect(isIgnoreStop('/* v8 ignore next */')).toBe(false);
  });

  it('is false for a start opener', () => {
    expect(isIgnoreStop('/* v8 ignore start -- reason */')).toBe(false);
  });

  it('is false for an ordinary comment', () => {
    expect(isIgnoreStop('/* a normal comment */')).toBe(false);
  });
});
