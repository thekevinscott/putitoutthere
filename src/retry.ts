/**
 * Retry with exponential backoff + jitter.
 *
 * Applied uniformly by the orchestrator rather than per-handler (plan.md
 * §13.3 / §7.3):
 *
 *   retries:        3
 *   initial_delay:  1s
 *   multiplier:     2          (1s, 2s, 4s)
 *   jitter:         ±25%
 *   retry_on:       TransientError, fetch 5xx, ECONNRESET, ETIMEDOUT, 429
 *   no_retry_on:    AuthError, other errors, 4xx (except 429)
 *
 * 429 honors the error's `retryAfter` hint (seconds) when present, so
 * registries asking us to back off get respected.
 *
 * Issue #10.
 */

import { AuthError, TransientError } from './types.js';

export interface RetryOptions {
  retries?: number;      // total attempts (not additional retries). Default 3.
  initialDelayMs?: number; // first backoff. Default 1000.
  multiplier?: number;   // each subsequent delay multiplies by this. Default 2.
  jitter?: number;       // ±jitter fraction. Default 0.25 for ±25%.
}

const DEFAULTS: Required<RetryOptions> = {
  retries: 3,
  initialDelayMs: 1000,
  multiplier: 2,
  jitter: 0.25,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { retries, initialDelayMs, multiplier, jitter } = { ...DEFAULTS, ...opts };

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      const baseDelay = initialDelayMs * Math.pow(multiplier, attempt - 1);
      const hinted = retryAfterMs(err);
      const delay = Math.max(baseDelay, hinted) + jitterOffset(baseDelay, jitter);
      await sleep(delay);
    }
  }
  // Unreachable: loop either returns or throws. TypeScript can't infer that.
  /* v8 ignore next 2 */
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof AuthError) return false;
  if (err instanceof TransientError) return true;
  // Network-ish error codes used by Node's net/http stack.
  const code = extractProp(err, 'code');
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT') return true;
  // HTTP-status-tagged errors: retry 5xx and 429.
  const status = extractProp(err, 'status');
  if (typeof status === 'number') {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }
  return false;
}

function retryAfterMs(err: unknown): number {
  const ra = extractProp(err, 'retryAfter');
  if (typeof ra === 'number' && ra > 0) return ra * 1000;
  return 0;
}

function extractProp(err: unknown, key: string): unknown {
  if (err && typeof err === 'object' && key in err) {
    return (err as Record<string, unknown>)[key];
  }
  return undefined;
}

function jitterOffset(baseDelay: number, fraction: number): number {
  /* v8 ignore next -- default jitter is 0.25; the <=0 guard isn't exercised */
  if (fraction <= 0) return 0;
  // ±fraction of the base delay.
  const amp = baseDelay * fraction;
  return (Math.random() * 2 - 1) * amp;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
