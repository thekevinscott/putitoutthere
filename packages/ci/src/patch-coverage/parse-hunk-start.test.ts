/**
 * Pins the post-image start-line parse for the patch-coverage gate (#468).
 * Reproduces the `.mjs`'s `@@ -A,B +C,D @@` regex (`/^@@ -\d+(?:,\d+)? \+(\d+)`)
 * — it returns the `+C` value, the absolute line number the hunk's first
 * added line sits on. Pure; exact assertions.
 */

import { describe, expect, it } from 'vitest';

import { parseHunkStart } from './parse-hunk-start.js';

describe('parseHunkStart', () => {
  it('reads the +C start of a normal two-sided hunk header', () => {
    expect(parseHunkStart('@@ -0,0 +5,1 @@')).toBe(5);
  });

  it('reads a multi-line +C,D header and ignores the trailing section text', () => {
    expect(parseHunkStart('@@ -1,2 +10,3 @@ function foo()')).toBe(10);
  });

  it('reads a single-line hunk header with no comma on either side', () => {
    expect(parseHunkStart('@@ -5 +7 @@')).toBe(7);
  });

  it('reads +C with a comma but a comma-less old side', () => {
    expect(parseHunkStart('@@ -0,0 +1 @@')).toBe(1);
  });

  it('reads a large multi-digit start line', () => {
    expect(parseHunkStart('@@ -100,4 +1234,8 @@')).toBe(1234);
  });

  it('returns null when the post-image token is absent', () => {
    expect(parseHunkStart('@@')).toBeNull();
  });

  it('returns null when the post-image token does not start with +', () => {
    expect(parseHunkStart('@@ -1,2 x @@')).toBeNull();
  });

  it('returns null when a non-+ token would still parse to a number after slicing', () => {
    // Guards against a `startsWith('+')` weakened to always-true: 'x5'.slice(1)
    // is '5', so a broken guard would wrongly return 5 instead of null.
    expect(parseHunkStart('@@ -1,2 x5 @@')).toBeNull();
  });

  it('returns null when the post-image token has no digits after the +', () => {
    expect(parseHunkStart('@@ -1,2 +abc @@')).toBeNull();
  });

  it('returns null when there is nothing after the + (empty digit run)', () => {
    expect(parseHunkStart('@@ -1,2 + @@')).toBeNull();
  });

  it('returns null when a digit-run character sorts below 0', () => {
    expect(parseHunkStart('@@ -1,2 +5.5 @@')).toBeNull();
  });

  it('returns null when a digit-run character sorts above 9', () => {
    expect(parseHunkStart('@@ -1,2 +5a @@')).toBeNull();
  });
});
