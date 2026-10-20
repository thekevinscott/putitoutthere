import { describe, expect, it } from 'vitest';

import { firstVersion } from './first-version.js';

describe('firstVersion', () => {
  it('returns the package default when set', () => {
    expect(firstVersion({ first_version: '0.3.0' })).toBe('0.3.0');
  });

  it('returns the fallback 0.1.0 when unset', () => {
    expect(firstVersion({})).toBe('0.1.0');
  });

  it('rejects an invalid first_version value', () => {
    expect(() => firstVersion({ first_version: 'not-a-semver' })).toThrow();
  });
});
