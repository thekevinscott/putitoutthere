import { beforeEach, describe, expect, it, vi } from 'vitest';

import { awaitPublished, PUBLISH_VISIBILITY_SLEEPS_S } from './await-published.js';
import { withRetry } from './retry.js';
import type { Logger } from './types.js';
import { sleep } from './utils/sleep.js';

vi.mock('./utils/sleep.js');
vi.mock('./retry.js', () => ({ withRetry: vi.fn(<T>(fn: () => Promise<T>) => fn()) }));

const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

function answers(...values: boolean[]): () => Promise<boolean> {
  const queue = [...values];
  return vi.fn(() => Promise.resolve(queue.shift() ?? false));
}

describe('awaitPublished', () => {
  it('returns true on the first read without sleeping', async () => {
    const check = answers(true);
    await expect(awaitPublished(check, 'a@1', log, [5, 10])).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sleeps through the schedule until the version shows up', async () => {
    const check = answers(false, false, true);
    await expect(awaitPublished(check, 'a@1', log, [5, 10, 15])).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sleep).mock.calls).toEqual([[5000], [10000]]);
    expect(log.info).toHaveBeenCalledWith('a@1 not visible on the registry yet; retrying in 5s');
  });

  it('returns false after one read per sleep plus a final read', async () => {
    const check = answers();
    await expect(awaitPublished(check, 'a@1', log, [5, 10])).resolves.toBe(false);
    expect(check).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sleep).mock.calls).toEqual([[5000], [10000]]);
  });

  it('accepts a version that appears on the final read', async () => {
    const check = answers(false, false, true);
    await expect(awaitPublished(check, 'a@1', log, [5, 10])).resolves.toBe(true);
  });

  it('wraps every read in the transient-error retry', async () => {
    const check = answers(false, true);
    await awaitPublished(check, 'a@1', log, [5]);
    expect(withRetry).toHaveBeenCalledTimes(2);
  });

  it('defaults to a schedule of about three minutes', async () => {
    const check = answers();
    await awaitPublished(check, 'a@1', log);
    expect(PUBLISH_VISIBILITY_SLEEPS_S).toEqual([5, 10, 15, 30, 60, 60]);
    expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual(
      PUBLISH_VISIBILITY_SLEEPS_S.map((s) => s * 1000),
    );
  });

  it('propagates a read error that outlasts its retries', async () => {
    const check = vi.fn(() => Promise.reject(new Error('pypi 403')));
    await expect(awaitPublished(check, 'a@1', log, [5])).rejects.toThrow('pypi 403');
    expect(sleep).not.toHaveBeenCalled();
  });
});
