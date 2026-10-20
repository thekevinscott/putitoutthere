import { describe, expect, it } from 'vitest';

import { isDynamicVersion } from './is-dynamic-version.js';

describe('isDynamicVersion', () => {
  it('is true when dynamic lists version', () => {
    expect(isDynamicVersion({ dynamic: ['version'] })).toBe(true);
  });

  it('is true when version is one of several dynamic fields', () => {
    expect(isDynamicVersion({ dynamic: ['readme', 'version'] })).toBe(true);
  });

  it('is false when dynamic omits version', () => {
    expect(isDynamicVersion({ dynamic: ['readme'] })).toBe(false);
  });

  it('is false when dynamic is absent', () => {
    expect(isDynamicVersion({})).toBe(false);
  });

  it('is false when dynamic is a string rather than an array', () => {
    expect(isDynamicVersion({ dynamic: 'version' })).toBe(false);
  });
});
