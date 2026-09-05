import { describe, expect, it } from 'vitest';

import { isWithinDir } from './is-within-dir.js';

describe('isWithinDir', () => {
  it('matches the directory itself', () => {
    expect(isWithinDir('artifacts', 'artifacts')).toBe(true);
  });

  it('matches the directory entry porcelain renders with a trailing slash', () => {
    expect(isWithinDir('artifacts/', 'artifacts')).toBe(true);
  });

  it('matches a file inside the directory', () => {
    expect(isWithinDir('artifacts/dist/lib.node', 'artifacts')).toBe(true);
  });

  it('does not match an unrelated path', () => {
    expect(isWithinDir('README.md', 'artifacts')).toBe(false);
  });

  it('does not match a sibling whose name merely starts with the directory name', () => {
    // The separator in the prefix is what stops `artifacts-old/` matching
    // `artifacts`; without it every same-prefixed sibling is swallowed.
    expect(isWithinDir('artifacts-old/lib.node', 'artifacts')).toBe(false);
  });

  it('does not match a path that merely ends with the directory name', () => {
    expect(isWithinDir('vendor/artifacts', 'artifacts')).toBe(false);
  });
});
