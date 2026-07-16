/**
 * Integration test for the fixture-materialize harness (#447, epic #442).
 *
 * Drives the real `piot-ci fixture-materialize <mode>` dispatch in-process —
 * `run()` from `cli.ts` → `runFixtureMaterialize` → `decideFixtureMaterialize`
 * + `applySubstitutions` — with only the OS boundary (`node:fs/promises`, the
 * exec seam) mocked. Unlike `src/fixture-materialize/run.test.ts` (which also
 * mocks `decide`), this exercises the real per-phase decision, so the
 * substitution set, git-init, and FIXTURE_VERSION export are asserted through
 * the actual command.
 */

import { appendFile, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { execInherit } from '../../src/utils/exec-inherit.js';

vi.mock('node:fs/promises');
vi.mock('../../src/utils/exec-inherit.js');

const readdirMock = vi.mocked(readdir);
const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);
const exec = vi.mocked(execInherit);

function dirent(name: string, parentPath: string): { name: string; parentPath: string; isFile: () => boolean } {
  return { name, parentPath, isFile: () => true };
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  exec.mockResolvedValue(undefined);
  process.env.FIXTURE = 'rust-vanilla-first-publish';
  process.env.RUN_ID = '77';
  process.env.RUN_ATTEMPT = '3';
  process.env.GITHUB_ENV = '/gh-env';
  readdirMock.mockResolvedValue([dirent('Cargo.toml', 'fixture-tree')] as unknown as Awaited<ReturnType<typeof readdir>>);
  readFileMock.mockResolvedValue('name = "crate-placeholder"\nversion = "__VERSION__"\n');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIXTURE;
  delete process.env.RUN_ID;
  delete process.env.RUN_ATTEMPT;
  delete process.env.GITHUB_ENV;
  delete process.env.FIXTURE_VERSION;
});

const materialize = (mode: string): Promise<number> => run(['node', 'piot-ci', 'fixture-materialize', mode]);

describe('piot-ci fixture-materialize (integration)', () => {
  it('plan: substitutes version + placeholder, exports FIXTURE_VERSION, and git-inits a first-publish fixture', async () => {
    await expect(materialize('plan')).resolves.toBe(0);
    expect(rm).toHaveBeenCalledWith('fixture-tree', { recursive: true, force: true });
    expect(cp).toHaveBeenCalledWith('packages/engine/tests/fixtures/rust-vanilla-first-publish', 'fixture-tree', {
      recursive: true,
    });
    expect(writeFileMock).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-77-3"\nversion = "0.0.1700000000"\n');
    expect(appendFile).toHaveBeenCalledWith('/gh-env', 'FIXTURE_VERSION=0.0.1700000000\n');
    expect(exec).toHaveBeenCalledWith('git', ['init', '-q', '-b', 'main'], { cwd: 'fixture-tree' });
    expect(exec).toHaveBeenCalledWith('git', ['commit', '-q', '-m', 'e2e: initial fixture'], {
      cwd: 'fixture-tree',
    });
  });

  it('build: substitutes 0.0.1 only — no placeholder rewrite, no git, no FIXTURE_VERSION export', async () => {
    await expect(materialize('build')).resolves.toBe(0);
    expect(writeFileMock).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-placeholder"\nversion = "0.0.1"\n');
    expect(appendFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('publish: uses FIXTURE_VERSION, rewrites placeholder, git-inits, does not export', async () => {
    process.env.FIXTURE_VERSION = '0.0.500';
    await expect(materialize('publish')).resolves.toBe(0);
    expect(writeFileMock).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-77-3"\nversion = "0.0.500"\n');
    expect(appendFile).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('git', ['add', '.'], { cwd: 'fixture-tree' });
  });
});
