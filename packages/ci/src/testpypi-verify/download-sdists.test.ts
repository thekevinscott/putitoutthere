/**
 * Composition-root wiring test for the sdist-download phase. Mocks the
 * subprocess boundary (`node:child_process`) and every decision collaborator,
 * isolating the loop: the project-URL build, the `curl` GET, the href
 * parse/match, the resolved artifact URL + announce, the exact `curl -o`
 * download, and the six-attempt retry that ends in the stderr failure line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { sleep } from '../utils/sleep.js';
import { downloadSdists } from './download-sdists.js';
import { errorMessage } from './error-message.js';
import { findSdistHref } from './find-sdist-href.js';
import { normalizeIndexUrl } from './normalize-index-url.js';
import { parseRequirement } from './parse-requirement.js';
import { parseSimpleIndexHrefs } from './parse-simple-index.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';
import { sdistFilenameFromHref } from './sdist-filename.js';

vi.mock('../utils/exec-capture.js');
vi.mock('../utils/sleep.js');
vi.mock('./error-message.js');
vi.mock('./find-sdist-href.js');
vi.mock('./normalize-index-url.js');
vi.mock('./parse-requirement.js');
vi.mock('./parse-simple-index.js');
vi.mock('./retry-sleep.js');
vi.mock('./sdist-filename.js');

const exec = vi.mocked(execCapture);
const sleepMock = vi.mocked(sleep);
const out: string[] = [];
const err: string[] = [];

// `fetchFailures` leading `curl` GETs reject before one returns the page.
function stubCurl(fetchFailures: number): void {
  let fetch = 0;
  exec.mockImplementation((_cmd, args) => {
    if (args?.[1] === '-o') {
      return Promise.resolve({ stdout: '', stderr: '' });
    }
    fetch += 1;
    if (fetch <= fetchFailures) {
      return Promise.reject(new Error('curl fetch failed'));
    }
    return Promise.resolve({ stdout: 'HTML', stderr: '' });
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
  vi.mocked(normalizeIndexUrl).mockReturnValue('https://norm/');
  vi.mocked(parseRequirement).mockReturnValue({ package: 'pkg', version: '1.0', stem: 'pkg' });
  vi.mocked(parseSimpleIndexHrefs).mockReturnValue(['H1']);
  vi.mocked(findSdistHref).mockReturnValue('https://files/pkg-1.0.tar.gz#s');
  vi.mocked(sdistFilenameFromHref).mockReturnValue('pkg-1.0.tar.gz');
  vi.mocked(retrySleepSeconds).mockImplementation((attempt) => attempt * 100);
  vi.mocked(errorMessage).mockReturnValue('ERRTEXT');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadSdists', () => {
  it('fetches the project page, matches the sdist, and downloads it', async () => {
    stubCurl(0);
    await expect(downloadSdists(['pkg==1.0'], 'IDX')).resolves.toBe(0);
    expect(normalizeIndexUrl).toHaveBeenCalledWith('IDX');
    expect(parseRequirement).toHaveBeenCalledWith('pkg==1.0');
    // 64 MiB cap so the capture doesn't ENOBUFS on a large simple-index page
    // (the maturin fixture's is ~1.1 MiB, past the seam's 1 MiB default).
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', 'https://norm/pkg/'], {
      maxBuffer: 67108864,
    });
    expect(parseSimpleIndexHrefs).toHaveBeenCalledWith('HTML');
    expect(findSdistHref).toHaveBeenCalledWith(['H1'], '-1.0.tar.gz');
    expect(sdistFilenameFromHref).toHaveBeenCalledWith('https://files/pkg-1.0.tar.gz#s');
    expect(out.join('')).toBe('Downloading sdist for pkg==1.0 from https://files/pkg-1.0.tar.gz#s\n');
    expect(exec).toHaveBeenCalledWith(
      'curl',
      ['-fsS', '-o', 'downloaded-sdists/pkg-1.0.tar.gz', 'https://files/pkg-1.0.tar.gz#s'],
    );
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('retries a fetch failure with the back-off line + sleep, then succeeds', async () => {
    stubCurl(2);
    await expect(downloadSdists(['pkg==1.0'], 'IDX')).resolves.toBe(0);
    expect(out.join('')).toBe(
      'TestPyPI sdist index lag for pkg==1.0; retrying in 100s\n' +
        'TestPyPI sdist index lag for pkg==1.0; retrying in 200s\n' +
        'Downloading sdist for pkg==1.0 from https://files/pkg-1.0.tar.gz#s\n',
    );
    expect(sleepMock).toHaveBeenCalledWith(100000);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it('raises the exact no-sdist error and fails after MAX_ATTEMPTS attempts', async () => {
    stubCurl(0);
    vi.mocked(findSdistHref).mockReturnValue(null);
    await expect(downloadSdists(['pkg==1.0'], 'IDX')).resolves.toBe(1);
    expect(err.join('')).toBe('failed to download sdist for pkg==1.0: ERRTEXT\n');
    expect(errorMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'no sdist ending -1.0.tar.gz on https://norm/pkg/' }),
    );
    // No sleep after the final attempt — the loop gives up rather than
    // waiting out a back-off it will never use.
    expect(sleepMock).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
    expect(retrySleepSeconds).toHaveBeenNthCalledWith(MAX_ATTEMPTS - 1, MAX_ATTEMPTS - 1);
  });
});

/**
 * The retry budget's whole job is to outlast TestPyPI's `/simple/` index
 * propagation lag. #642. Twin of the same contract in
 * `download-wheels.test.ts`; both loops share one budget and must clear the
 * same window.
 *
 * Modelled the way the lag actually presents for sdists: the project page
 * fetches fine, the freshly-published version simply is not listed on it yet,
 * so `findSdistHref` finds nothing until propagation completes.
 *
 * Asserted as a *duration*, not an attempt count, so it stays honest if the
 * back-off curve is ever reshaped.
 */
describe('download retry budget vs. TestPyPI index propagation (#642)', () => {
  // The slow end of the propagation window observed across #628 and #630
  // (4m19s), rounded down. The budget must clear this, not merely reach it.
  const OBSERVED_PROPAGATION_LAG_SECONDS = 259;

  /**
   * Real back-off, and a clock that only advances by what the loop actually
   * sleeps. The href appears the moment the accumulated wait covers the
   * observed lag — so this passes iff the budget outlasts it.
   */
  function stubIndexUntilPropagated(lagSeconds: number): { elapsed: () => number } {
    let elapsed = 0;
    vi.mocked(retrySleepSeconds).mockImplementation((attempt) => attempt * 10);
    sleepMock.mockImplementation((ms) => {
      elapsed += ms / 1000;
      return Promise.resolve();
    });
    stubCurl(0);
    vi.mocked(findSdistHref).mockImplementation(() =>
      elapsed >= lagSeconds ? 'https://files/pkg-1.0.tar.gz#s' : null,
    );
    return { elapsed: () => elapsed };
  }

  it('keeps retrying past the slowest observed propagation lag', async () => {
    const clock = stubIndexUntilPropagated(OBSERVED_PROPAGATION_LAG_SECONDS);
    await expect(downloadSdists(['pkg==1.0'], 'IDX')).resolves.toBe(0);
    expect(clock.elapsed()).toBeGreaterThanOrEqual(OBSERVED_PROPAGATION_LAG_SECONDS);
  });

  it('still gives up on a version that never appears', async () => {
    // The budget grows; it stays bounded. A genuinely broken publish must
    // still fail the gate rather than hang the job.
    stubIndexUntilPropagated(Number.POSITIVE_INFINITY);
    await expect(downloadSdists(['pkg==1.0'], 'IDX')).resolves.toBe(1);
    expect(err.join('')).toBe('failed to download sdist for pkg==1.0: ERRTEXT\n');
  });
});
