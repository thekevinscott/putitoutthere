/**
 * Composition-root wiring test for the fixture-materialize harness (#447). Both
 * collaborators are mocked — the OS boundary (`node:fs`, `node:child_process`)
 * and `./decide.js` — so this isolates the plumbing: the argv/env guards, the
 * exact wipe + copy, the manifest walk + rewrite, the FIXTURE_VERSION export,
 * and the exact git command sequence. The per-phase decisions are covered in
 * `decide.test.ts`; the literal-replace itself in `apply-substitutions.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideFixtureMaterialize } from './decide.js';
import { runFixtureMaterialize } from './run.js';

type Dirents = ReturnType<typeof readdirSync>;

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('./decide.js');

const exec = vi.mocked(execFileSync);
const decide = vi.mocked(decideFixtureMaterialize);
const readdir = vi.mocked(readdirSync);
const readFile = vi.mocked(readFileSync);
const writeFile = vi.mocked(writeFileSync);
const appendFile = vi.mocked(appendFileSync);
const out: string[] = [];

function dirent(name: string, parentPath: string, file = true): { name: string; parentPath: string; isFile: () => boolean } {
  return { name, parentPath, isFile: () => file };
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  process.env.FIXTURE = 'js-vanilla';
  process.env.RUN_ID = '111';
  process.env.RUN_ATTEMPT = '2';
  process.env.GITHUB_ENV = '/tmp/gh-env';
  delete process.env.FIXTURE_VERSION;
  decide.mockReturnValue({ substitutions: [], gitInit: false, writeFixtureVersion: false });
  readdir.mockReturnValue([]);
  readFile.mockReturnValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIXTURE;
  delete process.env.RUN_ID;
  delete process.env.RUN_ATTEMPT;
  delete process.env.GITHUB_ENV;
  delete process.env.FIXTURE_VERSION;
});

const argv = (mode?: string) => ['node', 'piot-ci', 'fixture-materialize', ...(mode === undefined ? [] : [mode])];

describe('runFixtureMaterialize: guards', () => {
  it('rejects a missing mode without touching the OS', () => {
    expect(runFixtureMaterialize(argv())).toBe(1);
    expect(out.join('')).toBe(
      '::error::fixture-materialize: mode must be one of plan|build|publish (got <none>).\n',
    );
    expect(rmSync).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode, echoing the bad value', () => {
    expect(runFixtureMaterialize(argv('deploy'))).toBe(1);
    expect(out.join('')).toBe(
      '::error::fixture-materialize: mode must be one of plan|build|publish (got deploy).\n',
    );
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('rejects a missing FIXTURE', () => {
    delete process.env.FIXTURE;
    expect(runFixtureMaterialize(argv('plan'))).toBe(1);
    expect(out.join('')).toBe('::error::fixture-materialize: FIXTURE must be set.\n');
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('rejects an empty FIXTURE', () => {
    process.env.FIXTURE = '';
    expect(runFixtureMaterialize(argv('plan'))).toBe(1);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('rejects the publish phase when FIXTURE_VERSION is unset', () => {
    expect(runFixtureMaterialize(argv('publish'))).toBe(1);
    expect(out.join('')).toBe(
      '::error::fixture-materialize: FIXTURE_VERSION must be set for the publish phase.\n',
    );
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('rejects the publish phase when FIXTURE_VERSION is empty', () => {
    process.env.FIXTURE_VERSION = '';
    expect(runFixtureMaterialize(argv('publish'))).toBe(1);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('rejects the plan phase when GITHUB_ENV is unset (writeFixtureVersion true)', () => {
    delete process.env.GITHUB_ENV;
    decide.mockReturnValue({ substitutions: [], gitInit: true, writeFixtureVersion: true });
    expect(runFixtureMaterialize(argv('plan'))).toBe(1);
    expect(out.join('')).toBe('::error::fixture-materialize: GITHUB_ENV must be set for the plan phase.\n');
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('rejects the plan phase when GITHUB_ENV is the empty string', () => {
    process.env.GITHUB_ENV = '';
    decide.mockReturnValue({ substitutions: [], gitInit: true, writeFixtureVersion: true });
    expect(runFixtureMaterialize(argv('plan'))).toBe(1);
    expect(out.join('')).toBe('::error::fixture-materialize: GITHUB_ENV must be set for the plan phase.\n');
    expect(rmSync).not.toHaveBeenCalled();
  });
});

describe('runFixtureMaterialize: version resolution feeds decide', () => {
  it('plan computes 0.0.<unix-seconds> from the clock', () => {
    runFixtureMaterialize(argv('plan'));
    expect(decide).toHaveBeenCalledWith({
      mode: 'plan',
      fixture: 'js-vanilla',
      version: '0.0.1700000000',
      runId: '111',
      runAttempt: '2',
    });
  });

  it('build uses the literal 0.0.1', () => {
    runFixtureMaterialize(argv('build'));
    expect(decide).toHaveBeenCalledWith({
      mode: 'build',
      fixture: 'js-vanilla',
      version: '0.0.1',
      runId: '111',
      runAttempt: '2',
    });
  });

  it('publish uses FIXTURE_VERSION verbatim', () => {
    process.env.FIXTURE_VERSION = '0.0.999';
    runFixtureMaterialize(argv('publish'));
    expect(decide).toHaveBeenCalledWith({
      mode: 'publish',
      fixture: 'js-vanilla',
      version: '0.0.999',
      runId: '111',
      runAttempt: '2',
    });
  });

  it('defaults RUN_ID / RUN_ATTEMPT to empty strings when unset', () => {
    delete process.env.RUN_ID;
    delete process.env.RUN_ATTEMPT;
    runFixtureMaterialize(argv('build'));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ runId: '', runAttempt: '' }));
  });
});

describe('runFixtureMaterialize: filesystem materialization', () => {
  it('wipes then copies the fixture into fixture-tree', () => {
    runFixtureMaterialize(argv('build'));
    expect(rmSync).toHaveBeenCalledWith('fixture-tree', { recursive: true, force: true });
    expect(cpSync).toHaveBeenCalledWith(join('packages/engine/test/fixtures', 'js-vanilla'), 'fixture-tree', {
      recursive: true,
    });
  });

  it('rewrites each of the four manifest basenames (and nothing else), reading recursively as UTF-8', () => {
    decide.mockReturnValue({
      substitutions: [{ from: '__VERSION__', to: '0.0.1' }],
      gitInit: false,
      writeFixtureVersion: false,
    });
    readFile.mockReturnValue('version = "__VERSION__"');
    readdir.mockReturnValue([
      dirent('putitoutthere.toml', 'fixture-tree'),
      dirent('Cargo.toml', 'fixture-tree/crate'),
      dirent('README.md', 'fixture-tree'),
      dirent('package.json', 'fixture-tree'),
      dirent('pyproject.toml', 'fixture-tree/py'),
      dirent('pyproject.toml', 'fixture-tree/dir', false),
    ] as unknown as Dirents);
    runFixtureMaterialize(argv('build'));

    expect(readdirSync).toHaveBeenCalledWith('fixture-tree', { recursive: true, withFileTypes: true });
    expect(readFile).toHaveBeenCalledWith(join('fixture-tree', 'putitoutthere.toml'), 'utf8');
    expect(readFile).toHaveBeenCalledTimes(4);
    expect(writeFile).toHaveBeenNthCalledWith(1, join('fixture-tree', 'putitoutthere.toml'), 'version = "0.0.1"');
    expect(writeFile).toHaveBeenNthCalledWith(2, join('fixture-tree/crate', 'Cargo.toml'), 'version = "0.0.1"');
    expect(writeFile).toHaveBeenNthCalledWith(3, join('fixture-tree', 'package.json'), 'version = "0.0.1"');
    expect(writeFile).toHaveBeenNthCalledWith(4, join('fixture-tree/py', 'pyproject.toml'), 'version = "0.0.1"');
    expect(writeFile).toHaveBeenCalledTimes(4);
  });

  it('exports FIXTURE_VERSION to GITHUB_ENV only when decide says to', () => {
    decide.mockReturnValue({ substitutions: [], gitInit: true, writeFixtureVersion: true });
    runFixtureMaterialize(argv('plan'));
    expect(appendFile).toHaveBeenCalledWith('/tmp/gh-env', 'FIXTURE_VERSION=0.0.1700000000\n');
  });

  it('does not touch GITHUB_ENV when decide says not to', () => {
    decide.mockReturnValue({ substitutions: [], gitInit: false, writeFixtureVersion: false });
    runFixtureMaterialize(argv('build'));
    expect(appendFile).not.toHaveBeenCalled();
  });
});

describe('runFixtureMaterialize: git init', () => {
  const GIT_SEQUENCE: readonly string[][] = [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.email', 'e2e@putitoutthere.dev'],
    ['config', 'user.name', 'piot e2e'],
    ['config', 'commit.gpgsign', 'false'],
    ['config', 'tag.gpgsign', 'false'],
    ['add', '.'],
    ['commit', '-q', '-m', 'e2e: initial fixture'],
  ];

  it('runs the exact git command sequence in fixture-tree when gitInit is true', () => {
    decide.mockReturnValue({ substitutions: [], gitInit: true, writeFixtureVersion: false });
    process.env.FIXTURE_VERSION = '0.0.5';
    expect(runFixtureMaterialize(argv('publish'))).toBe(0);
    expect(exec).toHaveBeenCalledTimes(GIT_SEQUENCE.length);
    GIT_SEQUENCE.forEach((args, i) => {
      expect(exec).toHaveBeenNthCalledWith(i + 1, 'git', args, { cwd: 'fixture-tree', stdio: 'inherit' });
    });
  });

  it('runs no git commands when gitInit is false', () => {
    decide.mockReturnValue({ substitutions: [], gitInit: false, writeFixtureVersion: false });
    runFixtureMaterialize(argv('build'));
    expect(exec).not.toHaveBeenCalled();
  });
});
