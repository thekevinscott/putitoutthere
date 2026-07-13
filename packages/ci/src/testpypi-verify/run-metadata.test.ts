/**
 * Composition-root wiring test for `testpypi-verify metadata`. Mocks the OS
 * boundary (`node:fs`) and every phase module, isolating the orchestration:
 * the env guard, the `dist/` listing, the requirements build + file write, the
 * download-dir reset, and the wheel→sdist→verify sequence with its short-circuit
 * on a non-zero phase exit.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRequirements } from './build-requirements.js';
import { downloadSdists } from './download-sdists.js';
import { downloadWheels } from './download-wheels.js';
import { runTestpypiMetadata } from './run-metadata.js';
import { verifyArtifacts } from './verify-artifacts.js';

vi.mock('node:fs');
vi.mock('./build-requirements.js');
vi.mock('./download-sdists.js');
vi.mock('./download-wheels.js');
vi.mock('./verify-artifacts.js');

const readdir = vi.mocked(readdirSync);
const build = vi.mocked(buildRequirements);
const wheels = vi.mocked(downloadWheels);
const sdists = vi.mocked(downloadSdists);
const verify = vi.mocked(verifyArtifacts);
const out: string[] = [];
const err: string[] = [];

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
  readdir.mockReturnValue([dirent('a.whl', true), dirent('nested', false)] as unknown as ReturnType<typeof readdirSync>);
  build.mockReturnValue({ requirements: ['a==1', 'b==2'] });
  wheels.mockReturnValue(0);
  sdists.mockReturnValue(0);
  verify.mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TESTPYPI_INDEX_URL;
});

describe('runTestpypiMetadata', () => {
  it.each(['', undefined])('fails when TESTPYPI_INDEX_URL is %j and does no I/O', (value) => {
    if (value === undefined) {
      delete process.env.TESTPYPI_INDEX_URL;
    } else {
      process.env.TESTPYPI_INDEX_URL = value;
    }
    expect(runTestpypiMetadata()).toBe(1);
    expect(out.join('')).toBe('::error::testpypi-verify: TESTPYPI_INDEX_URL must be set.\n');
    expect(readdir).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('fails with the build error on stderr and never downloads', () => {
    build.mockReturnValue({ errorLine: 'expected exactly one version for x, found []' });
    expect(runTestpypiMetadata()).toBe(1);
    expect(err.join('')).toBe('expected exactly one version for x, found []\n');
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(wheels).not.toHaveBeenCalled();
  });

  it('builds from dist files, writes requirements, resets dirs, and runs the phases in order', () => {
    expect(runTestpypiMetadata()).toBe(0);
    expect(build).toHaveBeenCalledWith(['a.whl']);
    expect(writeFileSync).toHaveBeenCalledWith('testpypi-requirements.txt', 'a==1\nb==2\n');
    expect(rmSync).toHaveBeenCalledWith('downloaded-wheels', { recursive: true, force: true });
    expect(rmSync).toHaveBeenCalledWith('downloaded-sdists', { recursive: true, force: true });
    expect(mkdirSync).toHaveBeenCalledWith('downloaded-wheels', { recursive: true });
    expect(mkdirSync).toHaveBeenCalledWith('downloaded-sdists', { recursive: true });
    expect(wheels).toHaveBeenCalledWith(['a==1', 'b==2'], 'https://test.pypi.org/simple/');
    expect(sdists).toHaveBeenCalledWith(['a==1', 'b==2'], 'https://test.pypi.org/simple/');
    expect(verify).toHaveBeenCalledWith(['a==1', 'b==2']);
  });

  it('short-circuits on a failed wheel download', () => {
    wheels.mockReturnValue(1);
    expect(runTestpypiMetadata()).toBe(1);
    expect(sdists).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('short-circuits on a failed sdist download', () => {
    sdists.mockReturnValue(1);
    expect(runTestpypiMetadata()).toBe(1);
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns the verify phase exit code', () => {
    verify.mockReturnValue(1);
    expect(runTestpypiMetadata()).toBe(1);
  });
});
