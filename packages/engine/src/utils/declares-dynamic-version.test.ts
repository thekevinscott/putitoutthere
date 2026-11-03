import { describe, expect, it } from 'vitest';

import { declaresDynamicVersion } from './declares-dynamic-version.js';

describe('declaresDynamicVersion', () => {
  it('is true when [project].dynamic lists version', () => {
    expect(declaresDynamicVersion({ dynamic: ['readme', 'version'] })).toBe(true);
  });

  it('is false when dynamic omits version', () => {
    expect(declaresDynamicVersion({ dynamic: ['readme'] })).toBe(false);
  });

  it('is false when dynamic is absent or not an array', () => {
    expect(declaresDynamicVersion({})).toBe(false);
    expect(declaresDynamicVersion({ dynamic: 'version' })).toBe(false);
  });
});
