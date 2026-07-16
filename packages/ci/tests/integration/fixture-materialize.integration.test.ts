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

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { spawn } from 'node:child_process';
import { appendFile, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam) for real and mock
// only the Node built-in underneath it: `spawn` (what `execInherit` uses).
// Mocking the seam module itself would trip the testing-conventions
// `no-first-party-mock` gate.
vi.mock('node:fs/promises');
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, spawn: vi.fn() };
});

const readdirMock = vi.mocked(readdir);
const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);
const spawnMock = vi.mocked(spawn);

/** A minimal spawn() stand-in that emits `close` with `code` on the next tick. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

function dirent(name: string, parentPath: string): { name: string; parentPath: string; isFile: () => boolean } {
  return { name, parentPath, isFile: () => true };
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  // Every git subprocess `execInherit` spawns exits 0.
  spawnMock.mockImplementation(((() => fakeChild(0)) as unknown) as typeof spawn);
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
    // `execInherit('git', args, { cwd })` spawns with stdio inherited and no env override.
    expect(spawnMock).toHaveBeenCalledWith('git', ['init', '-q', '-b', 'main'], {
      stdio: 'inherit',
      cwd: 'fixture-tree',
      env: undefined,
    });
    expect(spawnMock).toHaveBeenCalledWith('git', ['commit', '-q', '-m', 'e2e: initial fixture'], {
      stdio: 'inherit',
      cwd: 'fixture-tree',
      env: undefined,
    });
  });

  it('build: substitutes 0.0.1 only — no placeholder rewrite, no git, no FIXTURE_VERSION export', async () => {
    await expect(materialize('build')).resolves.toBe(0);
    expect(writeFileMock).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-placeholder"\nversion = "0.0.1"\n');
    expect(appendFile).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('publish: uses FIXTURE_VERSION, rewrites placeholder, git-inits, does not export', async () => {
    process.env.FIXTURE_VERSION = '0.0.500';
    await expect(materialize('publish')).resolves.toBe(0);
    expect(writeFileMock).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-77-3"\nversion = "0.0.500"\n');
    expect(appendFile).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledWith('git', ['add', '.'], { stdio: 'inherit', cwd: 'fixture-tree', env: undefined });
  });
});
