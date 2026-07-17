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
import { retrySleepSeconds } from './retry-sleep.js';
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

  it('raises the exact no-sdist error and fails after six attempts', async () => {
    stubCurl(0);
    vi.mocked(findSdistHref).mockReturnValue(null);
    await expect(downloadSdists(['pkg==1.0'], 'IDX')).resolves.toBe(1);
    expect(err.join('')).toBe('failed to download sdist for pkg==1.0: ERRTEXT\n');
    expect(errorMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'no sdist ending -1.0.tar.gz on https://norm/pkg/' }),
    );
    expect(sleepMock).toHaveBeenCalledTimes(5);
    expect(retrySleepSeconds).toHaveBeenNthCalledWith(5, 5);
  });
});
