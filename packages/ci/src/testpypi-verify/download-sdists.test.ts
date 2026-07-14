/**
 * Composition-root wiring test for the sdist-download phase. Mocks the
 * subprocess boundary (`node:child_process`) and every decision collaborator,
 * isolating the loop: the project-URL build, the `curl` GET, the href
 * parse/match, the resolved artifact URL + announce, the exact `curl -o`
 * download, and the six-attempt retry that ends in the stderr failure line.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadSdists } from './download-sdists.js';
import { errorMessage } from './error-message.js';
import { findSdistHref } from './find-sdist-href.js';
import { normalizeIndexUrl } from './normalize-index-url.js';
import { parseRequirement } from './parse-requirement.js';
import { parseSimpleIndexHrefs } from './parse-simple-index.js';
import { retrySleepSeconds } from './retry-sleep.js';
import { sdistFilenameFromHref } from './sdist-filename.js';

vi.mock('node:child_process');
vi.mock('./error-message.js');
vi.mock('./find-sdist-href.js');
vi.mock('./normalize-index-url.js');
vi.mock('./parse-requirement.js');
vi.mock('./parse-simple-index.js');
vi.mock('./retry-sleep.js');
vi.mock('./sdist-filename.js');

const exec = vi.mocked(execFileSync);
const out: string[] = [];
const err: string[] = [];

// `fetchFailures` leading `curl` GETs throw before one returns the page.
function stubCurl(fetchFailures: number): void {
  let fetch = 0;
  exec.mockImplementation((cmd: string, args?: readonly string[]) => {
    if (cmd === 'sleep') {
      return '';
    }
    if (args?.[1] === '-o') {
      return '';
    }
    fetch += 1;
    if (fetch <= fetchFailures) {
      throw new Error('curl fetch failed');
    }
    return 'HTML';
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

const sleepCalls = () => exec.mock.calls.filter((call) => call[0] === 'sleep');

describe('downloadSdists', () => {
  it('fetches the project page, matches the sdist, and downloads it', () => {
    stubCurl(0);
    expect(downloadSdists(['pkg==1.0'], 'IDX')).toBe(0);
    expect(normalizeIndexUrl).toHaveBeenCalledWith('IDX');
    expect(parseRequirement).toHaveBeenCalledWith('pkg==1.0');
    // 64 MiB cap so the capture doesn't ENOBUFS on a large simple-index page
    // (the maturin fixture's is ~1.1 MiB, past execFileSync's 1 MiB default).
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', 'https://norm/pkg/'], {
      encoding: 'utf8',
      maxBuffer: 67108864,
    });
    expect(parseSimpleIndexHrefs).toHaveBeenCalledWith('HTML');
    expect(findSdistHref).toHaveBeenCalledWith(['H1'], '-1.0.tar.gz');
    expect(sdistFilenameFromHref).toHaveBeenCalledWith('https://files/pkg-1.0.tar.gz#s');
    expect(out.join('')).toBe('Downloading sdist for pkg==1.0 from https://files/pkg-1.0.tar.gz#s\n');
    expect(exec).toHaveBeenCalledWith(
      'curl',
      ['-fsS', '-o', 'downloaded-sdists/pkg-1.0.tar.gz', 'https://files/pkg-1.0.tar.gz#s'],
      { stdio: 'ignore' },
    );
    expect(sleepCalls()).toHaveLength(0);
  });

  it('retries a fetch failure with the back-off line + sleep, then succeeds', () => {
    stubCurl(2);
    expect(downloadSdists(['pkg==1.0'], 'IDX')).toBe(0);
    expect(out.join('')).toBe(
      'TestPyPI sdist index lag for pkg==1.0; retrying in 100s\n' +
        'TestPyPI sdist index lag for pkg==1.0; retrying in 200s\n' +
        'Downloading sdist for pkg==1.0 from https://files/pkg-1.0.tar.gz#s\n',
    );
    expect(exec).toHaveBeenCalledWith('sleep', ['100'], { stdio: 'ignore' });
    expect(sleepCalls()).toHaveLength(2);
  });

  it('raises the exact no-sdist error and fails after six attempts', () => {
    stubCurl(0);
    vi.mocked(findSdistHref).mockReturnValue(null);
    expect(downloadSdists(['pkg==1.0'], 'IDX')).toBe(1);
    expect(err.join('')).toBe('failed to download sdist for pkg==1.0: ERRTEXT\n');
    expect(errorMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'no sdist ending -1.0.tar.gz on https://norm/pkg/' }),
    );
    expect(sleepCalls()).toHaveLength(5);
    expect(retrySleepSeconds).toHaveBeenNthCalledWith(5, 5);
  });
});
