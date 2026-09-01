/**
 * Wiring test for the release-metadata poll. Mocks the read, the back-off and
 * the sleep, isolating the loop: the URL build, the bounded retry with its
 * back-off line, and — the part #668 exists for — the two different terminal
 * messages a 404 and a transport failure produce.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sleep } from '../utils/sleep.js';
import { readReleaseFiles } from './read-release-files.js';
import { releaseJsonUrl } from './release-json-url.js';
import { resolveRelease } from './resolve-release.js';
import { retryBudgetSeconds } from './retry-budget-seconds.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

vi.mock('../utils/sleep.js');
vi.mock('./read-release-files.js');
vi.mock('./release-json-url.js');
vi.mock('./retry-budget-seconds.js');
vi.mock('./retry-sleep.js');

const read = vi.mocked(readReleaseFiles);
const jsonUrl = vi.mocked(releaseJsonUrl);
const budget = vi.mocked(retryBudgetSeconds);
const sleepMock = vi.mocked(sleep);
const sleepSecs = vi.mocked(retrySleepSeconds);
const out: string[] = [];
const FILES = { wheels: [{ filename: 'x-1.whl', url: 'https://f/x-1.whl' }], sdists: [] };

/** `failures` leading reads fail with `failure` before one returns the files. */
function stubRead(failures: number, failure: { notFound: boolean; reason: string }): void {
  let reads = 0;
  read.mockImplementation(() => {
    reads += 1;
    return Promise.resolve(reads <= failures ? { failure } : { files: FILES });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  jsonUrl.mockReturnValue('https://test.pypi.org/pypi/x/1/json');
  budget.mockReturnValue(450);
  sleepMock.mockResolvedValue(undefined);
  sleepSecs.mockImplementation((attempt) => attempt * 100);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveRelease', () => {
  it('reads the version-pinned URL for the requirement and returns its files', async () => {
    stubRead(0, { notFound: true, reason: 'HTTP 404' });
    await expect(resolveRelease('x==1', 'https://test.pypi.org/simple/')).resolves.toEqual({ files: FILES });
    expect(jsonUrl).toHaveBeenCalledWith('https://test.pypi.org/simple/', 'x', '1');
    expect(read).toHaveBeenCalledWith('https://test.pypi.org/pypi/x/1/json');
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('fails without reading when the index URL is not a URL', async () => {
    jsonUrl.mockReturnValue(null);
    await expect(resolveRelease('x==1', 'nonsense')).resolves.toEqual({
      errorLine: '::error::testpypi-verify: TESTPYPI_INDEX_URL is not a URL (nonsense).',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('retries with the back-off line, naming what it saw, then succeeds', async () => {
    stubRead(2, { notFound: true, reason: 'HTTP 404' });
    await expect(resolveRelease('x==1', 'https://i/')).resolves.toEqual({ files: FILES });
    expect(out.join('')).toBe(
      'TestPyPI has no release metadata for x==1 yet (HTTP 404); retrying in 100s\n' +
        'TestPyPI has no release metadata for x==1 yet (HTTP 404); retrying in 200s\n',
    );
    expect(sleepMock).toHaveBeenNthCalledWith(1, 100000);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 200000);
  });

  it('succeeds on the last attempt', async () => {
    stubRead(MAX_ATTEMPTS - 1, { notFound: true, reason: 'HTTP 404' });
    await expect(resolveRelease('x==1', 'https://i/')).resolves.toEqual({ files: FILES });
    expect(read).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('calls the version unpublished when 404 outlives the budget', async () => {
    // The distinction #668 turns on: a version the registry has never seen is
    // a broken publish, and the message must not read as index lag.
    stubRead(MAX_ATTEMPTS, { notFound: true, reason: 'HTTP 404' });
    await expect(resolveRelease('x==1', 'https://i/')).resolves.toEqual({
      errorLine:
        '::error::x==1 is not published to TestPyPI: https://test.pypi.org/pypi/x/1/json returned 404 for the full 450s budget',
    });
    // No sleep after the final attempt — the loop gives up rather than
    // waiting out a back-off it will never use.
    expect(sleepMock).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
  });

  it('does not call the version unpublished when the read never got an answer', async () => {
    // A registry that could not answer says nothing about whether the version
    // exists; reporting it as unpublished would send a reader to the wrong bug.
    stubRead(MAX_ATTEMPTS, { notFound: false, reason: 'HTTP 503' });
    const resolved = await resolveRelease('x==1', 'https://i/');
    expect(resolved).toEqual({
      errorLine:
        '::error::could not read TestPyPI release metadata for x==1 from https://test.pypi.org/pypi/x/1/json after 450s: HTTP 503',
    });
  });
});
