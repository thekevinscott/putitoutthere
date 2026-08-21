/**
 * Pins the retry budget: `retrySleepSeconds` = `attempt * 10`, and what that
 * curve adds up to over `MAX_ATTEMPTS`.
 *
 * The two live in one module because neither states a duration alone, and a
 * duration is the only thing this gate actually needs — it exists to outlast
 * TestPyPI's `/simple/` index propagation lag. #642.
 */

import { describe, expect, it } from 'vitest';

import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

/** What the download loops spend waiting before they give up. */
function totalBudgetSeconds(): number {
  let total = 0;
  // The loop sleeps between attempts, so the last attempt is not followed by
  // a back-off — N attempts spend N-1 sleeps.
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    total += retrySleepSeconds(attempt);
  }
  return total;
}

describe('retrySleepSeconds', () => {
  it('backs off by ten seconds per attempt', () => {
    expect(retrySleepSeconds(1)).toBe(10);
    expect(retrySleepSeconds(2)).toBe(20);
    expect(retrySleepSeconds(5)).toBe(50);
  });

  it('grows strictly with each attempt', () => {
    // A flat or shrinking curve would spend the same budget hammering the
    // index early instead of giving it time to catch up, which is the whole
    // point of backing off at all.
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      expect(retrySleepSeconds(attempt)).toBeGreaterThan(retrySleepSeconds(attempt - 1));
    }
  });
});

describe('the retry budget vs. TestPyPI index propagation', () => {
  // The slow end of the propagation window observed in the wild: 4m19s on
  // #628's E2E run and, independently, on #630. The budget has to clear it,
  // not merely reach it — a publish that succeeded must not be reported
  // broken because the index was still catching up.
  const OBSERVED_PROPAGATION_LAG_SECONDS = 259;

  it('outlasts the slowest propagation lag observed in the wild', () => {
    expect(totalBudgetSeconds()).toBeGreaterThan(OBSERVED_PROPAGATION_LAG_SECONDS);
  });

  it('stays bounded so a version that never appears still fails the gate', () => {
    // The other half of the contract. Unbounded retries would hang the job
    // on a genuinely broken publish instead of reporting it.
    expect(Number.isFinite(MAX_ATTEMPTS)).toBe(true);
    expect(totalBudgetSeconds()).toBeLessThan(30 * 60);
  });
});
