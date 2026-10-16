/**
 * Retry with exponential backoff + jitter, applied uniformly by the
 * orchestrator rather than per-handler (#10; plan.md §13.3 / §7.3). Retries
 * `TransientError`, fetch 5xx, ECONNRESET, ETIMEDOUT and 429; never
 * `AuthError` or any other 4xx. A 429 honours the error's `retryAfter` hint.
 */

import { isRetryable } from './is-retryable.js';
import { jitterOffset } from './jitter-offset.js';
import { retryAfterMs } from './retry-after-ms.js';
import { sleep } from './utils/sleep.js';

export interface RetryOptions {
  retries?: number;      // total attempts (not additional retries). Default 3.
  initialDelayMs?: number; // first backoff. Default 1000.
  multiplier?: number;   // each subsequent delay multiplies by this. Default 2.
  jitter?: number;       // ±jitter fraction. Default 0.25 for ±25%.
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const defaults: Required<RetryOptions> = {
    retries: 3,
    initialDelayMs: 1000,
    multiplier: 2,
    jitter: 0.25,
  };
  const { retries, initialDelayMs, multiplier, jitter } = { ...defaults, ...opts };

  // The final attempt (`attempt >= retries`) rethrows inside the catch, so a
  // positive `retries` always exits by returning or throwing from within the
  // loop. The statement after the loop is reached only when `retries <= 0`:
  // the loop never runs, no attempt is made, and there is no error to report.
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      const baseDelay = initialDelayMs * Math.pow(multiplier, attempt - 1);
      const hinted = retryAfterMs(err);
      const delay = Math.max(baseDelay, hinted) + jitterOffset(baseDelay, jitter);
      await sleep(delay);
    }
  }
  // `retries <= 0`: preserve the historical contract of rejecting with
  // `undefined` (the caller capped attempts at zero, so `fn` is never run).
  const nothingAttempted: unknown = undefined;
  throw nothingAttempted;
}
