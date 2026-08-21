/**
 * Composition-root wiring test for the wheel-download phase. Mocks the
 * subprocess boundary (`node:child_process`) and `./retry-sleep.js`, isolating
 * the loop: the per-requirement announce, the exact `pip download` invocation,
 * the bounded six-attempt retry with the back-off line + sleep, and the
 * failure line / early return.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execInherit } from '../utils/exec-inherit.js';
import { sleep } from '../utils/sleep.js';
import { downloadWheels } from './download-wheels.js';
import { retrySleepSeconds } from './retry-sleep.js';

vi.mock('../utils/exec-inherit.js');
vi.mock('../utils/sleep.js');
vi.mock('./retry-sleep.js');

const exec = vi.mocked(execInherit);
const sleepMock = vi.mocked(sleep);
const sleepSecs = vi.mocked(retrySleepSeconds);
const out: string[] = [];

// `pipFailures` leading `pip download` calls reject before one succeeds.
function stubPip(pipFailures: number): void {
  let pip = 0;
  exec.mockImplementation(() => {
    pip += 1;
    if (pip <= pipFailures) {
      return Promise.reject(new Error('pip download failed'));
    }
    return Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  sleepMock.mockResolvedValue(undefined);
  sleepSecs.mockImplementation((attempt) => attempt * 100);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadWheels', () => {
  it('announces, runs the exact pip download, and returns 0 on the first success', async () => {
    stubPip(0);
    await expect(downloadWheels(['a==1'], 'https://idx/')).resolves.toBe(0);
    expect(exec).toHaveBeenCalledWith(
      'python',
      ['-m', 'pip', 'download', '--index-url', 'https://idx/', '--no-deps', '--only-binary=:all:', '--dest', 'downloaded-wheels', 'a==1'],
    );
    expect(out.join('')).toBe('Downloading wheel for a==1 from TestPyPI\n');
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('retries with the back-off line + sleep, then succeeds', async () => {
    stubPip(2);
    await expect(downloadWheels(['a==1'], 'https://idx/')).resolves.toBe(0);
    expect(out.join('')).toBe(
      'Downloading wheel for a==1 from TestPyPI\n' +
        'TestPyPI wheel index lag for a==1; retrying in 100s\n' +
        'TestPyPI wheel index lag for a==1; retrying in 200s\n',
    );
    expect(sleepSecs).toHaveBeenNthCalledWith(1, 1);
    expect(sleepSecs).toHaveBeenNthCalledWith(2, 2);
    expect(sleepMock).toHaveBeenCalledWith(100000);
    expect(sleepMock).toHaveBeenCalledWith(200000);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it('fails after six attempts with the error line and five sleeps', async () => {
    stubPip(6);
    await expect(downloadWheels(['a==1'], 'https://idx/')).resolves.toBe(1);
    expect(out.join('')).toContain('::error::failed to download wheel for a==1 from TestPyPI\n');
    expect(sleepMock).toHaveBeenCalledTimes(5);
    expect(sleepSecs).toHaveBeenNthCalledWith(5, 5);
  });

  it('succeeds on the sixth and final attempt (six pip invocations)', async () => {
    stubPip(5);
    await expect(downloadWheels(['a==1'], 'https://idx/')).resolves.toBe(0);
    expect(exec.mock.calls.filter((call) => call[0] === 'python')).toHaveLength(6);
  });

  it('downloads each requirement in turn', async () => {
    stubPip(0);
    await expect(downloadWheels(['a==1', 'b==2'], 'https://idx/')).resolves.toBe(0);
    expect(out.join('')).toBe(
      'Downloading wheel for a==1 from TestPyPI\nDownloading wheel for b==2 from TestPyPI\n',
    );
  });

  it('stops at the first requirement that cannot be downloaded', async () => {
    stubPip(6);
    await expect(downloadWheels(['a==1', 'b==2'], 'https://idx/')).resolves.toBe(1);
    expect(out.join('')).not.toContain('b==2');
  });
});

/**
 * The retry budget's whole job is to outlast TestPyPI's `/simple/` index
 * propagation lag. #642.
 *
 * The failure this pins is a *false negative*: the publish succeeded, the
 * version is live on the JSON API and lands in `/simple/` shortly after, and
 * the gate reports the release broken anyway because it stopped waiting too
 * early. Observed on #628's `E2E` run and, independently, on #630 — TestPyPI
 * propagation between 2m35s and 4m19s against a budget that gives up at 150s.
 *
 * Asserted as a *duration*, not an attempt count, so it stays honest if the
 * back-off curve is ever reshaped: what matters is how long the loop waits,
 * not how many requests it splits that wait into.
 */
describe('download retry budget vs. TestPyPI index propagation (#642)', () => {
  // The slow end of the propagation window observed across #628 and #630
  // (4m19s), rounded down. The budget must clear this, not merely reach it.
  const OBSERVED_PROPAGATION_LAG_SECONDS = 259;

  /**
   * Real back-off, and a clock that only advances by what the loop actually
   * sleeps. `pip` starts succeeding the moment the accumulated wait covers
   * the observed lag — so this passes iff the budget outlasts it.
   */
  function stubPipUntilPropagated(lagSeconds: number): { elapsed: () => number } {
    let elapsed = 0;
    sleepSecs.mockImplementation((attempt) => attempt * 10);
    sleepMock.mockImplementation((ms) => {
      elapsed += ms / 1000;
      return Promise.resolve();
    });
    exec.mockImplementation(() =>
      elapsed >= lagSeconds
        ? Promise.resolve()
        : Promise.reject(new Error('ERROR: No matching distribution found')),
    );
    return { elapsed: () => elapsed };
  }

  it('keeps retrying past the slowest observed propagation lag', async () => {
    const clock = stubPipUntilPropagated(OBSERVED_PROPAGATION_LAG_SECONDS);
    await expect(downloadWheels(['a==1'], 'https://idx/')).resolves.toBe(0);
    expect(clock.elapsed()).toBeGreaterThanOrEqual(OBSERVED_PROPAGATION_LAG_SECONDS);
  });

  it('still gives up on a version that never appears', async () => {
    // The budget grows; it stays bounded. A genuinely broken publish must
    // still fail the gate rather than hang the job.
    stubPipUntilPropagated(Number.POSITIVE_INFINITY);
    await expect(downloadWheels(['a==1'], 'https://idx/')).resolves.toBe(1);
    expect(out.join('')).toContain('::error::failed to download wheel for a==1 from TestPyPI\n');
  });
});
