/**
 * Pins what the budget function itself does: sum one back-off per sleep the
 * retry loop takes — N attempts, N-1 sleeps, the last attempt followed by none.
 * The shipped curve and its bound are pinned in `retry-sleep.test.ts`; the
 * back-off is mocked here so this stays about the summing rather than about
 * today's curve.
 */

import { describe, expect, it, vi } from 'vitest';

import { retryBudgetSeconds } from './retry-budget-seconds.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

vi.mock('./retry-sleep.js');

const sleepSecs = vi.mocked(retrySleepSeconds);

describe('retryBudgetSeconds', () => {
  it('sums one back-off per sleep, not one per attempt', () => {
    sleepSecs.mockReturnValue(7);
    expect(retryBudgetSeconds()).toBe(7 * (MAX_ATTEMPTS - 1));
  });

  it('asks every attempt but the last for its own back-off', () => {
    sleepSecs.mockImplementation((attempt) => attempt * 10);
    retryBudgetSeconds();
    expect(sleepSecs.mock.calls.map(([attempt]) => attempt)).toEqual(
      Array.from({ length: MAX_ATTEMPTS - 1 }, (_, index) => index + 1),
    );
  });
});
