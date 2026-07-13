/**
 * Integration test for the fixture-materialize harness (#447, epic #442).
 *
 * Drives the real `piot-ci fixture-materialize <mode>` dispatch in-process —
 * `run()` from `cli.ts` → `runFixtureMaterialize` → `decideFixtureMaterialize`
 * + `applySubstitutions` — with only the OS boundary (`node:fs`,
 * `node:child_process`) mocked. Unlike `src/fixture-materialize/run.test.ts`
 * (which also mocks `decide`), this exercises the real per-phase decision, so
 * the substitution set, git-init, and FIXTURE_VERSION export are asserted
 * through the actual command.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:fs');
vi.mock('node:child_process');

const readdir = vi.mocked(readdirSync);
const readFile = vi.mocked(readFileSync);
const writeFile = vi.mocked(writeFileSync);
const exec = vi.mocked(execFileSync);

function dirent(name: string, parentPath: string): { name: string; parentPath: string; isFile: () => boolean } {
  return { name, parentPath, isFile: () => true };
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  process.env.FIXTURE = 'rust-vanilla-first-publish';
  process.env.RUN_ID = '77';
  process.env.RUN_ATTEMPT = '3';
  process.env.GITHUB_ENV = '/gh-env';
  readdir.mockReturnValue([dirent('Cargo.toml', 'fixture-tree')] as unknown as ReturnType<typeof readdirSync>);
  readFile.mockReturnValue('name = "crate-placeholder"\nversion = "__VERSION__"\n');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIXTURE;
  delete process.env.RUN_ID;
  delete process.env.RUN_ATTEMPT;
  delete process.env.GITHUB_ENV;
  delete process.env.FIXTURE_VERSION;
});

const materialize = (mode: string): number => run(['node', 'piot-ci', 'fixture-materialize', mode]);

describe('piot-ci fixture-materialize (integration)', () => {
  it('plan: substitutes version + placeholder, exports FIXTURE_VERSION, and git-inits a first-publish fixture', () => {
    expect(materialize('plan')).toBe(0);
    expect(rmSync).toHaveBeenCalledWith('fixture-tree', { recursive: true, force: true });
    expect(cpSync).toHaveBeenCalledWith('packages/engine/test/fixtures/rust-vanilla-first-publish', 'fixture-tree', {
      recursive: true,
    });
    expect(writeFile).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-77-3"\nversion = "0.0.1700000000"\n');
    expect(appendFileSync).toHaveBeenCalledWith('/gh-env', 'FIXTURE_VERSION=0.0.1700000000\n');
    expect(exec).toHaveBeenCalledWith('git', ['init', '-q', '-b', 'main'], { cwd: 'fixture-tree', stdio: 'inherit' });
    expect(exec).toHaveBeenCalledWith('git', ['commit', '-q', '-m', 'e2e: initial fixture'], {
      cwd: 'fixture-tree',
      stdio: 'inherit',
    });
  });

  it('build: substitutes 0.0.1 only — no placeholder rewrite, no git, no FIXTURE_VERSION export', () => {
    expect(materialize('build')).toBe(0);
    expect(writeFile).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-placeholder"\nversion = "0.0.1"\n');
    expect(appendFileSync).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('publish: uses FIXTURE_VERSION, rewrites placeholder, git-inits, does not export', () => {
    process.env.FIXTURE_VERSION = '0.0.500';
    expect(materialize('publish')).toBe(0);
    expect(writeFile).toHaveBeenCalledWith('fixture-tree/Cargo.toml', 'name = "crate-77-3"\nversion = "0.0.500"\n');
    expect(appendFileSync).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('git', ['add', '.'], { cwd: 'fixture-tree', stdio: 'inherit' });
  });
});
