/**
 * Pins the back-off curve: `retrySleepSeconds` = `attempt * 10`, bounded by
 * `MAX_ATTEMPTS`. What the pair adds up to is `retryBudgetSeconds`' contract,
 * pinned next to that function.
 */

import { describe, expect, it } from 'vitest';

import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

describe('retrySleepSeconds', () => {
  it('backs off by ten seconds per attempt', () => {
    expect(retrySleepSeconds(1)).toBe(10);
    expect(retrySleepSeconds(2)).toBe(20);
    expect(retrySleepSeconds(5)).toBe(50);
  });

  it('grows strictly with each attempt', () => {
    // A flat or shrinking curve would spend the same budget hammering the
    // registry early instead of giving it time to answer, which is the whole
    // point of backing off at all.
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      expect(retrySleepSeconds(attempt)).toBeGreaterThan(retrySleepSeconds(attempt - 1));
    }
  });
});

describe('MAX_ATTEMPTS', () => {
  it('is finite, so a version that never appears still fails the gate', () => {
    // Unbounded retries would hang the job on a genuinely broken publish
    // instead of reporting it.
    expect(Number.isFinite(MAX_ATTEMPTS)).toBe(true);
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});
