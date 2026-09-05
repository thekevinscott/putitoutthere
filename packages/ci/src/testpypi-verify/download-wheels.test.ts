/**
 * Composition-root wiring test for the wheel-download phase. Mocks the fetch
 * helper, isolating the loop: the per-wheel announce carrying the resolved
 * artifact URL, one fetch per wheel into the wheels directory, and the failure
 * line / early return.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadArtifact } from './download-artifact.js';
import { downloadWheels } from './download-wheels.js';
import type { ReleaseFiles } from './release-file-types.js';

vi.mock('./download-artifact.js');

const fetchArtifact = vi.mocked(downloadArtifact);
const out: string[] = [];

function release(name: string, wheels: string[]): ReleaseFiles {
  return {
    wheels: wheels.map((filename) => ({ filename, url: `https://f/${name}/${filename}` })),
    sdists: [{ filename: `${name}.tar.gz`, url: `https://f/${name}.tar.gz` }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  fetchArtifact.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadWheels', () => {
  it('announces the resolved URL and fetches into the wheels directory', async () => {
    await expect(downloadWheels(new Map([['a==1', release('a', ['a-1.whl'])]]))).resolves.toBe(0);
    expect(fetchArtifact).toHaveBeenCalledWith('https://f/a/a-1.whl', 'downloaded-wheels/a-1.whl');
    expect(out.join('')).toBe('Downloading wheel for a==1 from https://f/a/a-1.whl\n');
  });

  it('fetches every wheel of a multi-platform release', async () => {
    // A maturin fixture publishes one wheel per target; verifying only the
    // one a runner happens to be able to install would leave the rest unread.
    await expect(
      downloadWheels(new Map([['a==1', release('a', ['a-1-manylinux.whl', 'a-1-macosx.whl'])]])),
    ).resolves.toBe(0);
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
  });

  it('downloads each requirement in turn', async () => {
    await expect(
      downloadWheels(new Map([['a==1', release('a', ['a-1.whl'])], ['b==2', release('b', ['b-2.whl'])]])),
    ).resolves.toBe(0);
    expect(out.join('')).toBe(
      'Downloading wheel for a==1 from https://f/a/a-1.whl\nDownloading wheel for b==2 from https://f/b/b-2.whl\n',
    );
  });

  it('fails with the error line on a wheel that will not come down', async () => {
    fetchArtifact.mockResolvedValue(false);
    await expect(downloadWheels(new Map([['a==1', release('a', ['a-1.whl'])]]))).resolves.toBe(1);
    expect(out.join('')).toContain('::error::failed to download wheel for a==1 from TestPyPI\n');
  });

  it('stops at the first requirement that fails', async () => {
    fetchArtifact.mockResolvedValue(false);
    await expect(
      downloadWheels(new Map([['a==1', release('a', ['a-1.whl'])], ['b==2', release('b', ['b-2.whl'])]])),
    ).resolves.toBe(1);
    expect(out.join('')).not.toContain('b==2');
  });
});
