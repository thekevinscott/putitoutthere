/**
 * Composition-root wiring test for the wheel-download phase. Mocks the
 * subprocess boundary (`node:child_process`) and `./retry-sleep.js`, isolating
 * the loop: the per-requirement announce, the exact `pip download` invocation,
 * the bounded six-attempt retry with the back-off line + sleep, and the
 * failure line / early return.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadWheels } from './download-wheels.js';
import { retrySleepSeconds } from './retry-sleep.js';

vi.mock('node:child_process');
vi.mock('./retry-sleep.js');

const exec = vi.mocked(execFileSync);
const sleepSecs = vi.mocked(retrySleepSeconds);
const out: string[] = [];

// `pipFailures` leading `pip download` calls throw before one succeeds.
function stubPip(pipFailures: number): void {
  let pip = 0;
  exec.mockImplementation((cmd) => {
    if (cmd === 'sleep') {
      return '';
    }
    pip += 1;
    if (pip <= pipFailures) {
      throw new Error('pip download failed');
    }
    return '';
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  sleepSecs.mockImplementation((attempt) => attempt * 100);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sleepCalls = () => exec.mock.calls.filter((call) => call[0] === 'sleep');

describe('downloadWheels', () => {
  it('announces, runs the exact pip download, and returns 0 on the first success', () => {
    stubPip(0);
    expect(downloadWheels(['a==1'], 'https://idx/')).toBe(0);
    expect(exec).toHaveBeenCalledWith(
      'python',
      ['-m', 'pip', 'download', '--index-url', 'https://idx/', '--no-deps', '--only-binary=:all:', '--dest', 'downloaded-wheels', 'a==1'],
      { stdio: 'inherit' },
    );
    expect(out.join('')).toBe('Downloading wheel for a==1 from TestPyPI\n');
    expect(sleepCalls()).toHaveLength(0);
  });

  it('retries with the back-off line + sleep, then succeeds', () => {
    stubPip(2);
    expect(downloadWheels(['a==1'], 'https://idx/')).toBe(0);
    expect(out.join('')).toBe(
      'Downloading wheel for a==1 from TestPyPI\n' +
        'TestPyPI wheel index lag for a==1; retrying in 100s\n' +
        'TestPyPI wheel index lag for a==1; retrying in 200s\n',
    );
    expect(sleepSecs).toHaveBeenNthCalledWith(1, 1);
    expect(sleepSecs).toHaveBeenNthCalledWith(2, 2);
    expect(exec).toHaveBeenCalledWith('sleep', ['100'], { stdio: 'ignore' });
    expect(exec).toHaveBeenCalledWith('sleep', ['200'], { stdio: 'ignore' });
    expect(sleepCalls()).toHaveLength(2);
  });

  it('fails after six attempts with the error line and five sleeps', () => {
    stubPip(6);
    expect(downloadWheels(['a==1'], 'https://idx/')).toBe(1);
    expect(out.join('')).toContain('::error::failed to download wheel for a==1 from TestPyPI\n');
    expect(sleepCalls()).toHaveLength(5);
    expect(sleepSecs).toHaveBeenNthCalledWith(5, 5);
  });

  it('succeeds on the sixth and final attempt (six pip invocations)', () => {
    stubPip(5);
    expect(downloadWheels(['a==1'], 'https://idx/')).toBe(0);
    expect(exec.mock.calls.filter((call) => call[0] === 'python')).toHaveLength(6);
  });

  it('downloads each requirement in turn', () => {
    stubPip(0);
    expect(downloadWheels(['a==1', 'b==2'], 'https://idx/')).toBe(0);
    expect(out.join('')).toBe(
      'Downloading wheel for a==1 from TestPyPI\nDownloading wheel for b==2 from TestPyPI\n',
    );
  });

  it('stops at the first requirement that cannot be downloaded', () => {
    stubPip(6);
    expect(downloadWheels(['a==1', 'b==2'], 'https://idx/')).toBe(1);
    expect(out.join('')).not.toContain('b==2');
  });
});
