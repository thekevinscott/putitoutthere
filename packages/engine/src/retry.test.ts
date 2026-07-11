/**
 * Retry policy tests. Exercises withRetry against synthetic errors.
 *
 * Semantics per plan.md §13.3 / §7.3.
 *
 * Issue #10.
 *
 * Pattern note: rejection tests use Promise.all(expect.rejects, runTimers)
 * so the `.rejects` matcher attaches a handler synchronously before
 * vitest advances fake timers. Without that, the rejection fires during
 * timer flush and Node flags it as unhandled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry.js';
import { AuthError, TransientError } from './types.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = withRetry(fn);
    await vi.runAllTimersAsync();
    expect(await out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on TransientError up to 3 attempts total', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('5xx'))
      .mockRejectedValueOnce(new TransientError('5xx'))
      .mockResolvedValueOnce('finally');
    const out = withRetry(fn);
    await vi.runAllTimersAsync();
    expect(await out).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting 3 attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError('persistent'));
    const out = withRetry(fn);
    await Promise.all([
      expect(out).rejects.toBeInstanceOf(TransientError),
      vi.runAllTimersAsync(),
    ]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on AuthError', async () => {
    const fn = vi.fn().mockRejectedValue(new AuthError('bad token'));
    const out = withRetry(fn);
    await Promise.all([
      expect(out).rejects.toBeInstanceOf(AuthError),
      vi.runAllTimersAsync(),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on arbitrary Error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('weird'));
    const out = withRetry(fn);
    await Promise.all([
      expect(out).rejects.toThrow('weird'),
      vi.runAllTimersAsync(),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on network-style error codes (ECONNRESET, ETIMEDOUT)', async () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT'] as const) {
      const err = Object.assign(new Error('socket'), { code });
      const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
      const out = withRetry(fn);
      await vi.runAllTimersAsync();
      expect(await out).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    }
  });

  it('retries on a 5xx-tagged error', async () => {
    const err = Object.assign(new Error('server error'), { status: 503 });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    const out = withRetry(fn);
    await vi.runAllTimersAsync();
    expect(await out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a 4xx-tagged error other than 429', async () => {
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);
    const out = withRetry(fn);
    await Promise.all([
      expect(out).rejects.toThrow('bad request'),
      vi.runAllTimersAsync(),
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    const out = withRetry(fn);
    await vi.runAllTimersAsync();
    expect(await out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After (seconds) on 429 by sleeping at least that long', async () => {
    const err = Object.assign(new Error('rate limited'), {
      status: 429,
      retryAfter: 7, // seconds
    });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    const out = withRetry(fn);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(7000);
    expect(await out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects a custom retries cap', async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError('x'));
    const out = withRetry(fn, { retries: 5 });
    await Promise.all([
      expect(out).rejects.toBeInstanceOf(TransientError),
      vi.runAllTimersAsync(),
    ]);
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
