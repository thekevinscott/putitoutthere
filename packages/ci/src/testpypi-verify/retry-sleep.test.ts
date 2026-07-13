/**
 * Pins `retrySleepSeconds` = `attempt * 10`.
 */

import { describe, expect, it } from 'vitest';

import { retrySleepSeconds } from './retry-sleep.js';

describe('retrySleepSeconds', () => {
  it('backs off by ten seconds per attempt', () => {
    expect(retrySleepSeconds(1)).toBe(10);
    expect(retrySleepSeconds(2)).toBe(20);
    expect(retrySleepSeconds(5)).toBe(50);
  });
});
