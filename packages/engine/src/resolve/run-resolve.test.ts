/**
 * Wiring test for the resolve composition root: the OS boundary
 * (`node:fs/promises`, the exec seam, `pathExists`) is mocked; the pure
 * collaborators (`parseFixtureDocument`, `buildCallbackMap`,
 * `repoSlugFromRepositoryUrl`) and the real package.json stay real, so
 * the emitted key is pinned against the actual repository.url.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { pathExists } from '../utils/path-exists.js';
import { runResolve } from './run-resolve.js';

// Real modules: the assertions build expected paths with them.
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('node:fs/promises');
vi.mock('../utils/exec-capture.js');
vi.mock('../utils/path-exists.js');

const readdirMock = vi.mocked(readdir);
const execMock = vi.mocked(execCapture);
const pathExistsMock = vi.mocked(pathExists);

type Dirents = Awaited<ReturnType<typeof readdir>>;

function dirent(name: string, dir = true): { name: string; isDirectory: () => boolean } {
  return { name, isDirectory: () => dir };
}

const CWD = '/repo';
const CORE_BIN = join(CWD, 'node_modules', '@putitoutthere', 'ci', 'dist', 'cli-bin.js');

function doc(fixture: string, hasPypi = false): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify({ fixture, matrix: [{ name: fixture }], has_pypi: hasPypi }) + '\n',
    stderr: '',
  };
}

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
  pathExistsMock.mockResolvedValue(true);
  readdirMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runResolve', () => {
  it('prints {} and exits 0 when the checkout does not define the e2e workflow', async () => {
    pathExistsMock.mockResolvedValueOnce(false);
    const code = await runResolve({ cwd: CWD });
    expect(code).toBe(0);
    expect(stdout.join('')).toBe('{}\n');
    expect(pathExistsMock).toHaveBeenCalledWith(
      join(CWD, '.github', 'workflows', 'e2e-fixture-job.yml'),
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  it('fails closed when the workflow exists but the fixtures root is missing', async () => {
    pathExistsMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runResolve({ cwd: CWD })).rejects.toThrow(
      'resolve: fixtures root missing at packages/engine/tests/fixtures',
    );
    expect(stdout.join('')).toBe('');
  });

  it('spawns the fixture-matrix core once per fixture directory, sorted, from the checkout', async () => {
    readdirMock.mockResolvedValue([
      dirent('js-vanilla'),
      dirent('README.md', false),
      dirent('js-napi'),
    ] as unknown as Dirents);
    execMock.mockResolvedValueOnce(doc('js-napi')).mockResolvedValueOnce(doc('js-vanilla'));

    const code = await runResolve({ cwd: CWD });

    expect(code).toBe(0);
    expect(readdirMock).toHaveBeenCalledWith(
      join(CWD, 'packages', 'engine', 'tests', 'fixtures'),
      { withFileTypes: true },
    );
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [CORE_BIN, 'fixture-matrix', 'js-napi'],
      { cwd: CWD },
    );
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [CORE_BIN, 'fixture-matrix', 'js-vanilla'],
      { cwd: CWD },
    );
  });

  it('emits one JSON line keyed by the frozen #153 key from the real repository.url', async () => {
    readdirMock.mockResolvedValue([dirent('js-vanilla')] as unknown as Dirents);
    execMock.mockResolvedValueOnce(doc('js-vanilla'));

    const code = await runResolve({ cwd: CWD });

    expect(code).toBe(0);
    expect(stdout.join('')).toBe(
      JSON.stringify({
        'thekevinscott/putitoutthere/.github/workflows/e2e-fixture-job.yml:plan': [
          {
            inputs: { fixture: 'js-vanilla' },
            outputs: { matrix: '[{"name":"js-vanilla"}]', has_pypi: 'false' },
          },
        ],
      }) + '\n',
    );
  });

  it('propagates a core failure without writing a partial map', async () => {
    readdirMock.mockResolvedValue([dirent('a'), dirent('b')] as unknown as Dirents);
    execMock.mockResolvedValueOnce(doc('a')).mockRejectedValueOnce(new Error('core exploded'));
    await expect(runResolve({ cwd: CWD })).rejects.toThrow('core exploded');
    expect(stdout.join('')).toBe('');
  });

  it('propagates a malformed document without writing a partial map', async () => {
    readdirMock.mockResolvedValue([dirent('a')] as unknown as Dirents);
    execMock.mockResolvedValueOnce({ stdout: 'not json\n', stderr: '' });
    await expect(runResolve({ cwd: CWD })).rejects.toThrow(/invalid JSON for 'a'/);
    expect(stdout.join('')).toBe('');
  });
});
