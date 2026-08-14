import { describe, expect, it, vi } from 'vitest';

import { retryTransient } from './retry-transient.js';

const deps = () => ({
  isTransient: vi.fn<(err: unknown) => boolean>().mockReturnValue(true),
  sleep: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
});

describe('retryTransient', () => {
  it('returns the first success without consulting isTransient or sleeping', async () => {
    const { isTransient, sleep } = deps();
    const operation = vi.fn().mockResolvedValue('ok');

    await expect(
      retryTransient(operation, { attempts: 4, backoffMs: 5, isTransient, sleep }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(isTransient).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure after sleeping backoffMs and returns the later success', async () => {
    const { isTransient, sleep } = deps();
    const boom = new Error('boom');
    const operation = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue('ok');

    await expect(
      retryTransient(operation, { attempts: 4, backoffMs: 5, isTransient, sleep }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(isTransient).toHaveBeenCalledWith(boom);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5]);
  });

  it('doubles the backoff on each consecutive retry', async () => {
    const { isTransient, sleep } = deps();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValue('ok');

    await expect(
      retryTransient(operation, { attempts: 4, backoffMs: 5, isTransient, sleep }),
    ).resolves.toBe('ok');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5, 10, 20]);
  });

  it('rethrows the last error once the attempts are exhausted', async () => {
    const { isTransient, sleep } = deps();
    const last = new Error('last');
    const operation = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValue(last);

    await expect(
      retryTransient(operation, { attempts: 2, backoffMs: 5, isTransient, sleep }),
    ).rejects.toBe(last);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-transient failure immediately without sleeping', async () => {
    const { sleep } = deps();
    const fatal = new Error('fatal');
    const operation = vi.fn().mockRejectedValue(fatal);
    const isTransient = vi.fn().mockReturnValue(false);

    await expect(
      retryTransient(operation, { attempts: 4, backoffMs: 5, isTransient, sleep }),
    ).rejects.toBe(fatal);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never sleeps when attempts is 1, even for a transient failure', async () => {
    const { isTransient, sleep } = deps();
    const only = new Error('only');
    const operation = vi.fn().mockRejectedValue(only);

    await expect(
      retryTransient(operation, { attempts: 1, backoffMs: 5, isTransient, sleep }),
    ).rejects.toBe(only);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
