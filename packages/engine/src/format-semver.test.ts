import { describe, expect, it } from 'vitest';

import { formatSemver } from './format-semver.js';

describe('formatSemver', () => {
  it('joins major, minor, and patch with dots', () => {
    expect(formatSemver({ major: 1, minor: 20, patch: 3 })).toBe('1.20.3');
  });
});
