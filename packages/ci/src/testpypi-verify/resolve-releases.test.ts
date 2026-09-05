/**
 * Wiring test for the resolve phase. Mocks the per-requirement resolve and the
 * shape check, isolating the loop: every requirement resolved before anything
 * is downloaded, and a first-failure stop that reports the resolver's or the
 * shape check's own line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseShapeError } from './release-shape-error.js';
import { resolveRelease } from './resolve-release.js';
import { resolveReleases } from './resolve-releases.js';

vi.mock('./release-shape-error.js');
vi.mock('./resolve-release.js');

const resolveOne = vi.mocked(resolveRelease);
const shapeError = vi.mocked(releaseShapeError);
const filesFor = (name: string): { wheels: { filename: string; url: string }[]; sdists: never[] } => ({
  wheels: [{ filename: `${name}.whl`, url: `https://f/${name}.whl` }],
  sdists: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  resolveOne.mockImplementation((requirement) => Promise.resolve({ files: filesFor(requirement) }));
  shapeError.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveReleases', () => {
  it('resolves every requirement and keys the releases by it', async () => {
    const resolved = await resolveReleases(['a==1', 'b==2'], 'https://i/');
    expect(resolved).toEqual({ releases: new Map([['a==1', filesFor('a==1')], ['b==2', filesFor('b==2')]]) });
    expect(resolveOne).toHaveBeenNthCalledWith(1, 'a==1', 'https://i/');
    expect(resolveOne).toHaveBeenNthCalledWith(2, 'b==2', 'https://i/');
  });

  it('stops at the first requirement that will not resolve', async () => {
    resolveOne.mockResolvedValueOnce({ errorLine: '::error::a==1 is not published to TestPyPI' });
    await expect(resolveReleases(['a==1', 'b==2'], 'https://i/')).resolves.toEqual({
      errorLine: '::error::a==1 is not published to TestPyPI',
    });
    expect(resolveOne).toHaveBeenCalledTimes(1);
  });

  it('stops on a release whose file list is the wrong shape', async () => {
    shapeError.mockReturnValueOnce('::error::a==1 is published to TestPyPI but its release lists no wheel');
    await expect(resolveReleases(['a==1', 'b==2'], 'https://i/')).resolves.toEqual({
      errorLine: '::error::a==1 is published to TestPyPI but its release lists no wheel',
    });
    expect(shapeError).toHaveBeenCalledWith('a==1', filesFor('a==1'));
    expect(resolveOne).toHaveBeenCalledTimes(1);
  });

  it('resolves nothing for an empty requirement list', async () => {
    await expect(resolveReleases([], 'https://i/')).resolves.toEqual({ releases: new Map() });
    expect(resolveOne).not.toHaveBeenCalled();
  });
});
