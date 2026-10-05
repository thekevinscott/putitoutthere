import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bare automocks (no factory): the per-version read and the wait are driven
// directly, so the whole retry budget is asserted without spending it and no
// registry is touched. `npmVersionDocUrl` is left REAL — the messages below
// quote the URL it builds, so a mocked one would assert nothing.
vi.mock('./read-version-doc.js');
vi.mock('../../utils/sleep.js');

import { readNpmVersionDoc } from './read-version-doc.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import { sleep } from '../../utils/sleep.js';

const readMock = vi.mocked(readNpmVersionDoc);
const sleepMock = vi.mocked(sleep);

const DOC = 'https://registry.npmjs.org/@scope%2Fpkg/1.0.0';
const out: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveNpmTarballUrl', () => {
  it('returns the tarball URL from the first read, saying nothing', async () => {
    readMock.mockResolvedValue({ status: 'found', tarball: 'https://reg/pkg.tgz' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'found',
      url: 'https://reg/pkg.tgz',
    });
    expect(readMock).toHaveBeenCalledWith(DOC);
    expect(sleepMock).not.toHaveBeenCalled();
    expect(out.join('')).toBe('');
  });

  it('reads the per-version document at an explicit registry', async () => {
    readMock.mockResolvedValue({ status: 'found', tarball: 'https://reg/pkg.tgz' });

    await resolveNpmTarballUrl('@scope/pkg', '1.0.0', 'http://localhost:4873');

    expect(readMock).toHaveBeenCalledWith('http://localhost:4873/@scope%2Fpkg/1.0.0');
  });

  it('retries a 404, because the caller just published this version', async () => {
    readMock
      .mockResolvedValueOnce({ status: 'missing' })
      .mockResolvedValue({ status: 'found', tarball: 'https://reg/pkg.tgz' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'found',
      url: 'https://reg/pkg.tgz',
    });
    // Live npm answered 404 here within a second of four successful
    // publishes, so a first-read 404 is lag; the log says 404 rather than
    // inventing a cause for it.
    expect(out.join('')).toBe(
      '  registry read did not resolve (attempt 1/10): HTTP 404; retrying in 2s\n',
    );
    expect(sleepMock.mock.calls).toEqual([[2000]]);
  });

  it('gives up on a 404 that never clears, naming both possible causes', async () => {
    readMock.mockResolvedValue({ status: 'missing' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'failed',
      reason: `${DOC} did not resolve after 10 attempts; last read: HTTP 404. Either the publish did not reach the registry, or propagation exceeded the budget.`,
    });
    expect(readMock).toHaveBeenCalledTimes(10);
  });

  it('fails a document carrying no dist.tarball, also without retrying', async () => {
    readMock.mockResolvedValue({ status: 'untarballed' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'failed',
      reason: `${DOC} carries no dist.tarball, so there is nothing to download.`,
    });
    // The one failure a further read cannot change, so it costs no wait.
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('retries a read that did not complete, announcing each wait', async () => {
    readMock
      .mockResolvedValueOnce({ status: 'unreadable', detail: 'HTTP 503' })
      .mockResolvedValueOnce({ status: 'unreadable', detail: 'ECONNRESET' })
      .mockResolvedValue({ status: 'found', tarball: 'https://reg/pkg.tgz' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'found',
      url: 'https://reg/pkg.tgz',
    });
    expect(out.join('')).toBe(
      '  registry read did not resolve (attempt 1/10): HTTP 503; retrying in 2s\n' +
        '  registry read did not resolve (attempt 2/10): ECONNRESET; retrying in 5s\n',
    );
    expect(sleepMock.mock.calls).toEqual([[2000], [5000]]);
  });

  it('gives up after ten reads, naming the last failure', async () => {
    readMock.mockResolvedValue({ status: 'unreadable', detail: 'HTTP 500' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'failed',
      reason: `${DOC} did not resolve after 10 attempts; last read: HTTP 500. Either the publish did not reach the registry, or propagation exceeded the budget.`,
    });
    expect(readMock).toHaveBeenCalledTimes(10);
    // 307s of waiting, no larger than the 320s budget this replaces — the
    // change is that it is spent on uncached reads, which can change answer.
    expect(sleepMock.mock.calls).toEqual([
      [2000], [5000], [10_000], [20_000], [30_000], [60_000], [60_000], [60_000], [60_000],
    ]);
  });
});
