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
