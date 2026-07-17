/**
 * Loop-control coverage for pollUntilResolved. The decision collaborators
 * (citationResolution, pollPendingMessage) are mocked so this isolates the
 * poll orchestration: the empty-needles short-circuit, the resolve-and-stop
 * path, the log→sleep→reset iteration body, and the deadline boundary. All
 * time and I/O are injected fakes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { citationResolution } from './citation-resolution.js';
import { pollPendingMessage } from './poll-message.js';
import { pollUntilResolved } from './poll.js';

vi.mock('./citation-resolution.js');
vi.mock('./poll-message.js');

const resolution = vi.mocked(citationResolution);
const message = vi.mocked(pollPendingMessage);

afterEach(() => {
  vi.restoreAllMocks();
});

function deps(overrides: {
  needles: Iterable<string>;
  now: () => number;
  deadlineMs?: number;
}): Parameters<typeof pollUntilResolved>[0] {
  return {
    needles: new Set(overrides.needles),
    deadlineMs: overrides.deadlineMs ?? 1000,
    now: overrides.now,
    sleep: vi.fn(() => Promise.resolve()),
    log: vi.fn(),
    loadRuns: vi.fn(() => Promise.resolve([])),
    jobsForRun: vi.fn(() => []),
    resetCaches: vi.fn(),
  };
}

describe('pollUntilResolved', () => {
  it('returns immediately, touching nothing, when there are no needles', async () => {
    const now = vi.fn(() => 0);
    const d = deps({ needles: [], now });
    await pollUntilResolved(d);
    expect(now).not.toHaveBeenCalled();
    expect(d.loadRuns).not.toHaveBeenCalled();
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it('loads runs once and stops without sleeping when everything resolves first look', async () => {
    resolution.mockReturnValue('passed');
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(0);
    const d = deps({ needles: ['a'], now });
    await pollUntilResolved(d);
    expect(d.loadRuns).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
    expect(d.resetCaches).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it('logs the elapsed message, sleeps, and resets caches per pending iteration', async () => {
    resolution.mockReturnValueOnce('pending').mockReturnValue('passed');
    message.mockReturnValue('POLL-MSG');
    // now(): start=1000, while=1000, elapsed=4000, while=1000. deadline=2000.
    // Elapsed is (4000 - 1000)/1000 = 3s; a `now() + start` bug would report 5s.
    const now = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(4000)
      .mockReturnValue(1000);
    const d = deps({ needles: ['a'], now, deadlineMs: 1000 });

    await pollUntilResolved(d);

    expect(d.loadRuns).toHaveBeenCalledTimes(2);
    expect(message).toHaveBeenCalledWith(3, ['a']);
    expect(d.log).toHaveBeenCalledExactlyOnceWith('POLL-MSG');
    expect(d.sleep).toHaveBeenCalledTimes(1);
    expect(d.resetCaches).toHaveBeenCalledTimes(1);
    // Order within the iteration body: log, then sleep, then reset.
    const logOrder = vi.mocked(d.log).mock.invocationCallOrder[0] ?? 0;
    const sleepOrder = vi.mocked(d.sleep).mock.invocationCallOrder[0] ?? 0;
    const resetOrder = vi.mocked(d.resetCaches).mock.invocationCallOrder[0] ?? 0;
    expect(logOrder).toBeLessThan(sleepOrder);
    expect(sleepOrder).toBeLessThan(resetOrder);
  });

  it('stops at the deadline when citations never resolve', async () => {
    resolution.mockReturnValue('pending');
    message.mockReturnValue('POLL-MSG');
    // start=0, while=0 (enter), elapsed=0, then while=1000 (== deadline, exit).
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1000);
    const d = deps({ needles: ['a'], now, deadlineMs: 1000 });

    await pollUntilResolved(d);

    expect(d.loadRuns).toHaveBeenCalledTimes(1);
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });
});
