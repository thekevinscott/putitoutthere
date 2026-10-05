/**
 * Composition-root wiring test for `pypi-tag-verify prepare`. Mocks the OS
 * boundary (`node:fs/promises`, `execInherit`) and the two pure cores,
 * isolating the plumbing: the `dist/` listing, the throwaway tree, the git
 * steps, the step output, and the exit code.
 */

import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execInherit } from '../utils/exec-inherit.js';
import { fixtureConfigToml } from './fixture-config-toml.js';
import { runPypiTagPrepare } from './run-prepare.js';
import { decideUploadedExpectations } from './uploaded-expectations.js';

vi.mock('node:fs/promises');
vi.mock('../utils/exec-inherit.js');
vi.mock('./fixture-config-toml.js');
vi.mock('./uploaded-expectations.js');

const readdirMock = vi.mocked(readdir);
const exec = vi.mocked(execInherit);
const decide = vi.mocked(decideUploadedExpectations);
const toToml = vi.mocked(fixtureConfigToml);
const out: string[] = [];

const TREE = '/runner/_temp/piot-pypi-tag';
const EXPECTATIONS = [{ name: 'pkg', version: '0.0.1', tag: 'pkg-v0.0.1' }];

function dirent(name: string, file: boolean): { name: string; isFile: () => boolean } {
  return { name, isFile: () => file };
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  readdirMock.mockResolvedValue([
    dirent('pkg-0.0.1.tar.gz', true),
    dirent('nested', false),
  ] as unknown as Awaited<ReturnType<typeof readdir>>);
  decide.mockReturnValue({ expectations: EXPECTATIONS });
  toToml.mockReturnValue('[putitoutthere]\n');
  process.env.TAG_TREE = TREE;
  process.env.GITHUB_OUTPUT = '/gh-output';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TAG_TREE;
  delete process.env.GITHUB_OUTPUT;
});

describe('runPypiTagPrepare', () => {
  it('lists dist files (directories filtered) and decides from them', async () => {
    await expect(runPypiTagPrepare()).resolves.toBe(0);
    expect(readdirMock).toHaveBeenCalledWith('dist', { withFileTypes: true });
    expect(decide).toHaveBeenCalledWith(['pkg-0.0.1.tar.gz']);
  });

  it('writes a fresh throwaway tree holding the generated config', async () => {
    await expect(runPypiTagPrepare()).resolves.toBe(0);
    expect(rm).toHaveBeenCalledWith(TREE, { recursive: true, force: true });
    expect(mkdir).toHaveBeenCalledWith(TREE, { recursive: true });
    expect(toToml).toHaveBeenCalledWith(EXPECTATIONS);
    expect(writeFile).toHaveBeenCalledWith(`${TREE}/putitoutthere.toml`, '[putitoutthere]\n');
  });

  it('inits and commits the tree, adding no remote', async () => {
    await expect(runPypiTagPrepare()).resolves.toBe(0);
    const calls = exec.mock.calls.map((call) => [call[0], call[1]]);
    expect(calls).toEqual([
      ['git', ['init', '-q', '-b', 'main']],
      ['git', ['config', 'user.email', 'e2e@putitoutthere.dev']],
      ['git', ['config', 'user.name', 'piot e2e']],
      ['git', ['config', 'commit.gpgsign', 'false']],
      ['git', ['config', 'tag.gpgsign', 'false']],
      ['git', ['add', '.']],
      ['git', ['commit', '-q', '-m', 'e2e: pypi-tag fixture']],
    ]);
    // Every step runs inside the throwaway tree, never the checkout.
    expect(exec.mock.calls.map((call) => call[2]?.cwd)).toEqual(
      Array.from({ length: 7 }, () => TREE),
    );
  });

  it('exports the expectation as the step output, and logs it', async () => {
    await expect(runPypiTagPrepare()).resolves.toBe(0);
    expect(appendFile).toHaveBeenCalledWith(
      '/gh-output',
      `expect=${JSON.stringify(EXPECTATIONS)}\n`,
    );
    expect(out.join('')).toBe('  expecting pkg@0.0.1 -> pkg-v0.0.1\n');
  });

  it('fails on the decision error, writing nothing', async () => {
    decide.mockReturnValue({ errorLine: 'pypi-tag-verify: nope' });
    await expect(runPypiTagPrepare()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::pypi-tag-verify: nope\n');
    expect(rm).not.toHaveBeenCalled();
    expect(appendFile).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('fails when TAG_TREE is %s, before touching the filesystem', async (_label, value) => {
    // Without it the reconcile step would run against the checkout itself.
    if (value === undefined) {
      delete process.env.TAG_TREE;
    } else {
      process.env.TAG_TREE = value;
    }
    await expect(runPypiTagPrepare()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::pypi-tag-verify: TAG_TREE must be set.\n');
    expect(readdirMock).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('fails when GITHUB_OUTPUT is %s', async (_label, value) => {
    if (value === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = value;
    }
    await expect(runPypiTagPrepare()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::pypi-tag-verify: GITHUB_OUTPUT must be set.\n');
    expect(readdirMock).not.toHaveBeenCalled();
  });
});
