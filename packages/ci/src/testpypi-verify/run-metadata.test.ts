/**
 * Composition-root wiring test for `testpypi-verify metadata`. Mocks the OS
 * boundary (`node:fs/promises`) and every phase module, isolating the
 * orchestration: the env guard, the `dist/` listing, the requirements build +
 * file write, the download-dir reset, and the resolve→wheel→sdist→verify
 * sequence with its short-circuit on a non-zero phase exit.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRequirements } from './build-requirements.js';
import { downloadSdists } from './download-sdists.js';
import { downloadWheels } from './download-wheels.js';
import { resolveReleases } from './resolve-releases.js';
import { runTestpypiMetadata } from './run-metadata.js';
import { verifyArtifacts } from './verify-artifacts.js';

vi.mock('node:fs/promises');
vi.mock('./build-requirements.js');
vi.mock('./download-sdists.js');
vi.mock('./download-wheels.js');
vi.mock('./resolve-releases.js');
vi.mock('./verify-artifacts.js');

const readdirMock = vi.mocked(readdir);
const build = vi.mocked(buildRequirements);
const resolve = vi.mocked(resolveReleases);
const wheels = vi.mocked(downloadWheels);
const sdists = vi.mocked(downloadSdists);
const verify = vi.mocked(verifyArtifacts);
const out: string[] = [];
const err: string[] = [];

const RELEASES = new Map([
  ['a==1', { wheels: [{ filename: 'a-1.whl', url: 'https://f/a-1.whl' }], sdists: [] }],
]);

function dirent(name: string, file: boolean): { name: string; isFile: () => boolean } {
  return { name, isFile: () => file };
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
  process.env.TESTPYPI_INDEX_URL = 'https://test.pypi.org/simple/';
  readdirMock.mockResolvedValue([dirent('a.whl', true), dirent('nested', false)] as unknown as Awaited<ReturnType<typeof readdir>>);
  build.mockReturnValue({ requirements: ['a==1', 'b==2'] });
  resolve.mockResolvedValue({ releases: RELEASES });
  wheels.mockResolvedValue(0);
  sdists.mockResolvedValue(0);
  verify.mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TESTPYPI_INDEX_URL;
});

describe('runTestpypiMetadata', () => {
  it.each(['', undefined])('fails when TESTPYPI_INDEX_URL is %j and does no I/O', async (value) => {
    if (value === undefined) {
      delete process.env.TESTPYPI_INDEX_URL;
    } else {
      process.env.TESTPYPI_INDEX_URL = value;
    }
    await expect(runTestpypiMetadata()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::testpypi-verify: TESTPYPI_INDEX_URL must be set.\n');
    expect(readdirMock).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('fails with the build error on stderr and never resolves', async () => {
    build.mockReturnValue({ errorLine: 'expected exactly one version for x, found []' });
    await expect(runTestpypiMetadata()).resolves.toBe(1);
    expect(err.join('')).toBe('expected exactly one version for x, found []\n');
    expect(writeFile).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('builds from dist files, writes requirements, resets dirs, and runs the phases in order', async () => {
    await expect(runTestpypiMetadata()).resolves.toBe(0);
    expect(readdirMock).toHaveBeenCalledWith('dist', { withFileTypes: true });
    expect(build).toHaveBeenCalledWith(['a.whl']);
    expect(writeFile).toHaveBeenCalledWith('testpypi-requirements.txt', 'a==1\nb==2\n');
    expect(rm).toHaveBeenCalledWith('downloaded-wheels', { recursive: true, force: true });
    expect(rm).toHaveBeenCalledWith('downloaded-sdists', { recursive: true, force: true });
    expect(mkdir).toHaveBeenCalledWith('downloaded-wheels', { recursive: true });
    expect(mkdir).toHaveBeenCalledWith('downloaded-sdists', { recursive: true });
    expect(resolve).toHaveBeenCalledWith(['a==1', 'b==2'], 'https://test.pypi.org/simple/');
    expect(wheels).toHaveBeenCalledWith(RELEASES);
    expect(sdists).toHaveBeenCalledWith(RELEASES);
    expect(verify).toHaveBeenCalledWith(['a==1', 'b==2']);
  });

  it('reports the resolver line and downloads nothing when a release will not resolve', async () => {
    // Resolution runs before any fetch, so an absent or wrong-shaped release
    // is reported as such instead of as a download that failed.
    resolve.mockResolvedValue({ errorLine: '::error::a==1 is not published to TestPyPI' });
    await expect(runTestpypiMetadata()).resolves.toBe(1);
    expect(out.join('')).toContain('::error::a==1 is not published to TestPyPI\n');
    expect(wheels).not.toHaveBeenCalled();
    expect(sdists).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('short-circuits on a failed wheel download', async () => {
    wheels.mockResolvedValue(1);
    await expect(runTestpypiMetadata()).resolves.toBe(1);
    expect(sdists).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('short-circuits on a failed sdist download', async () => {
    sdists.mockResolvedValue(1);
    await expect(runTestpypiMetadata()).resolves.toBe(1);
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns the verify phase exit code', async () => {
    verify.mockResolvedValue(1);
    await expect(runTestpypiMetadata()).resolves.toBe(1);
  });
});
