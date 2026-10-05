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

  it('fails a 404 on the first read, because an immutable 404 is never lag', async () => {
    readMock.mockResolvedValue({ status: 'missing' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'failed',
      reason: `${DOC} returned 404. That document is immutable and written at publish time, so this version was never published — waiting does not change the answer.`,
    });
    // The whole point of #716: no budget is spent on a question already
    // answered, and no answer is given that the reader has to second-guess.
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('fails a document carrying no dist.tarball, also without retrying', async () => {
    readMock.mockResolvedValue({ status: 'untarballed' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'failed',
      reason: `${DOC} carries no dist.tarball, so there is nothing to download.`,
    });
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
      '  registry read failed (attempt 1/6): HTTP 503; retrying in 2s\n' +
        '  registry read failed (attempt 2/6): ECONNRESET; retrying in 5s\n',
    );
    expect(sleepMock.mock.calls).toEqual([[2000], [5000]]);
  });

  it('gives up after six reads, naming the last failure', async () => {
    readMock.mockResolvedValue({ status: 'unreadable', detail: 'HTTP 500' });

    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0')).toEqual({
      status: 'failed',
      reason: `could not read ${DOC} after 6 attempts; last failure: HTTP 500.`,
    });
    expect(readMock).toHaveBeenCalledTimes(6);
    // 67s in total, and every second of it is a registry that would not
    // answer — not a publish being waited out.
    expect(sleepMock.mock.calls).toEqual([[2000], [5000], [10_000], [20_000], [30_000]]);
  });
});
