/**
 * Wiring test for a single artifact fetch. Mocks the exec seam, the back-off
 * and the sleep, isolating the loop: the exact `curl` invocation, the bounded
 * retry with its message, and the boolean the download phases branch on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { sleep } from '../utils/sleep.js';
import { downloadArtifact } from './download-artifact.js';
import { errorMessage } from './error-message.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

vi.mock('../utils/exec-capture.js');
vi.mock('../utils/sleep.js');
vi.mock('./error-message.js');
vi.mock('./retry-sleep.js');

const exec = vi.mocked(execCapture);
const sleepMock = vi.mocked(sleep);
const sleepSecs = vi.mocked(retrySleepSeconds);
const message = vi.mocked(errorMessage);
const out: string[] = [];
const err: string[] = [];

/** `failures` leading `curl` calls reject before one succeeds. */
function stubCurl(failures: number): void {
  let calls = 0;
  exec.mockImplementation(() => {
    calls += 1;
    return calls <= failures
      ? Promise.reject(new Error('curl: (22) 503'))
      : Promise.resolve({ stdout: '', stderr: '' });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  err.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  sleepMock.mockResolvedValue(undefined);
  sleepSecs.mockImplementation((attempt) => attempt * 100);
  message.mockReturnValue('curl: (22) 503');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadArtifact', () => {
  it('runs the exact curl and reports success without sleeping', async () => {
    stubCurl(0);
    await expect(downloadArtifact('https://f/x-1.whl', 'downloaded-wheels/x-1.whl')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', '-o', 'downloaded-wheels/x-1.whl', 'https://f/x-1.whl']);
    expect(sleepMock).not.toHaveBeenCalled();
    expect(out.join('')).toBe('');
  });

  it('retries a transport failure with the back-off line, then succeeds', async () => {
    stubCurl(2);
    await expect(downloadArtifact('https://f/x-1.whl', 'd/x-1.whl')).resolves.toBe(true);
    // The URL is immutable, so a failure here is a network fault — the line
    // must not send a reader looking for registry propagation.
    expect(out.join('')).toBe(
      'download failed for https://f/x-1.whl; retrying in 100s\ndownload failed for https://f/x-1.whl; retrying in 200s\n',
    );
    expect(sleepMock).toHaveBeenNthCalledWith(1, 100000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 200000);
  });

  it('succeeds on the last attempt', async () => {
    stubCurl(MAX_ATTEMPTS - 1);
    await expect(downloadArtifact('https://f/x-1.whl', 'd/x-1.whl')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('gives up after the budget, reporting the underlying error on stderr', async () => {
    stubCurl(MAX_ATTEMPTS);
    await expect(downloadArtifact('https://f/x-1.whl', 'd/x-1.whl')).resolves.toBe(false);
    expect(err.join('')).toBe('download failed for https://f/x-1.whl: curl: (22) 503\n');
    // No sleep after the final attempt.
    expect(sleepMock).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
  });
});
