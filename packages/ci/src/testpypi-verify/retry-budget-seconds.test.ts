/**
 * Pins the budget as a duration — the only form in which it means anything —
 * and the two properties it must hold: long enough to absorb a read replica
 * trailing an accepted upload, and finite, so a version that never appears
 * fails the gate instead of hanging the job.
 */

import { describe, expect, it } from 'vitest';

import { retryBudgetSeconds } from './retry-budget-seconds.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

describe('retryBudgetSeconds', () => {
  it('sums the back-offs the loop actually sleeps', () => {
    // N attempts, N-1 sleeps: the last attempt is not followed by a back-off
    // the loop will never use.
    let expected = 0;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expected += retrySleepSeconds(attempt);
    }
    expect(retryBudgetSeconds()).toBe(expected);
  });

  it('leaves room for a read replica trailing an accepted upload', () => {
    expect(retryBudgetSeconds()).toBeGreaterThanOrEqual(60);
  });

  it('stays bounded', () => {
    expect(retryBudgetSeconds()).toBeLessThan(30 * 60);
  });
});
