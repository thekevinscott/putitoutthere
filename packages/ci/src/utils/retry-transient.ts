/**
 * Run `operation`, retrying while `isTransient(err)` holds (#613): up to
 * `attempts` total tries, sleeping `backoffMs` before the first retry and
 * doubling it each time. A non-transient failure, or exhausting the
 * attempts, rethrows the last error unchanged. All timing flows through the
 * injected `sleep` seam so callers (and tests) control the clock.
 */
export interface RetryTransientOptions {
  attempts: number;
  backoffMs: number;
  isTransient: (err: unknown) => boolean;
  sleep: (ms: number) => Promise<void>;
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryTransientOptions,
): Promise<T> {
  let backoff = options.backoffMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= options.attempts || !options.isTransient(err)) {
        throw err;
      }
      await options.sleep(backoff);
      backoff *= 2;
    }
  }
}
