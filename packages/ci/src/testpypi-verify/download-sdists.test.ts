/**
 * Composition-root wiring test for the sdist-download phase. Mocks the fetch
 * helper, isolating the loop: the per-sdist announce carrying the resolved
 * artifact URL, one fetch per sdist into the sdists directory, and the stderr
 * failure line / early return.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadArtifact } from './download-artifact.js';
import { downloadSdists } from './download-sdists.js';
import type { ReleaseFiles } from './release-file-types.js';

vi.mock('./download-artifact.js');

const fetchArtifact = vi.mocked(downloadArtifact);
const out: string[] = [];
const err: string[] = [];

function release(name: string): ReleaseFiles {
  return {
    wheels: [{ filename: `${name}.whl`, url: `https://f/${name}.whl` }],
    sdists: [{ filename: `${name}.tar.gz`, url: `https://f/${name}.tar.gz` }],
  };
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
  fetchArtifact.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadSdists', () => {
  it('announces the resolved URL and fetches into the sdists directory', async () => {
    await expect(downloadSdists(new Map([['a==1', release('a')]]))).resolves.toBe(0);
    expect(fetchArtifact).toHaveBeenCalledWith('https://f/a.tar.gz', 'downloaded-sdists/a.tar.gz');
    expect(out.join('')).toBe('Downloading sdist for a==1 from https://f/a.tar.gz\n');
  });

  it('downloads each requirement in turn', async () => {
    await expect(downloadSdists(new Map([['a==1', release('a')], ['b==2', release('b')]]))).resolves.toBe(0);
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
  });

  it('fails on stderr for an sdist that will not come down', async () => {
    fetchArtifact.mockResolvedValue(false);
    await expect(downloadSdists(new Map([['a==1', release('a')]]))).resolves.toBe(1);
    expect(err.join('')).toBe('failed to download sdist for a==1 from TestPyPI\n');
  });

  it('stops at the first requirement that fails', async () => {
    fetchArtifact.mockResolvedValue(false);
    await expect(downloadSdists(new Map([['a==1', release('a')], ['b==2', release('b')]]))).resolves.toBe(1);
    expect(out.join('')).not.toContain('b==2');
  });
});
