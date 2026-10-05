import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});

const spawnMock = vi.mocked(spawn);

interface Call {
  argv: string[];
  cwd: string | undefined;
  env: NodeJS.ProcessEnv | undefined;
}

function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

function wire(failing: string[] = []): Call[] {
  const calls: Call[] = [];
  spawnMock.mockImplementation(((cmd: string, args: readonly string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    const argv = [cmd, ...args];
    calls.push({ argv, cwd: opts.cwd, env: opts.env });
    return fakeChild(failing.includes(argv.join(' ')) ? 1 : 0);
  }) as unknown as typeof spawn);
  return calls;
}

let root: string;
let out: string[];

function file(rel: string, body = '{}'): void {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
}

function npmBuild(...args: string[]): Promise<number> {
  return run(['node', 'putitoutthere', 'npm-build', '--cwd', root, ...args]);
}

function row(path: string): string[] {
  return ['--path', path, '--target', 'linux-x64-gnu', '--build', 'napi', '--version', '1.2.3'];
}

beforeEach(() => {
  spawnMock.mockReset();
  root = mkdtempSync(join(tmpdir(), 'piot-npm-build-int-'));
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    out.push(String(s));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('npm-build: installer selection', () => {
  it('a workspace member with only an ancestor pnpm-lock.yaml installs with pnpm', async () => {
    file('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    file('packages/a/package.json');
    const calls = wire();

    expect(await npmBuild(...row('packages/a'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toEqual([
      'npm install -g pnpm@11',
      'pnpm install --frozen-lockfile',
      'npm run build --if-present',
    ]);
    expect(calls[1]!.cwd).toBe(join(root, 'packages/a'));
  });

  it('a workspace member with only an ancestor pnpm-workspace.yaml installs with pnpm', async () => {
    file('pnpm-workspace.yaml', "packages: ['packages/*']\n");
    file('packages/a/package.json');
    const calls = wire();

    expect(await npmBuild(...row('packages/a'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toContain('pnpm install --frozen-lockfile');
  });

  it('a local package-lock.json installs with npm ci', async () => {
    file('pkg/package.json');
    file('pkg/package-lock.json');
    const calls = wire();

    expect(await npmBuild(...row('pkg'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toEqual(['npm ci', 'npm run build --if-present']);
    expect(calls[0]!.cwd).toBe(join(root, 'pkg'));
  });

  it('an ancestor package-lock.json (npm workspace) installs with npm ci', async () => {
    file('package-lock.json');
    file('packages/a/package.json');
    const calls = wire();

    expect(await npmBuild(...row('packages/a'))).toBe(0);

    expect(calls[0]!.argv.join(' ')).toBe('npm ci');
  });

  it('the nearest lockfile wins over one further up', async () => {
    file('package-lock.json');
    file('packages/a/package.json');
    file('packages/a/pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    const calls = wire();

    expect(await npmBuild(...row('packages/a'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toContain('pnpm install --frozen-lockfile');
  });

  it('nothing found falls back to a bare npm install', async () => {
    file('pkg/package.json');
    const calls = wire();

    expect(await npmBuild(...row('pkg'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toEqual(['npm install', 'npm run build --if-present']);
  });

  it('the walk stops at --cwd: a lockfile above it is ignored', async () => {
    file('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    file('repo/pkg/package.json');
    const calls = wire();

    const code = await run([
      'node', 'putitoutthere', 'npm-build', '--cwd', join(root, 'repo'), ...row('pkg'),
    ]);

    expect(code).toBe(0);
    expect(calls.map((c) => c.argv.join(' '))).toEqual(['npm install', 'npm run build --if-present']);
    expect(calls[0]!.cwd).toBe(join(root, 'repo/pkg'));
  });
});

describe('npm-build: strict install self-heals', () => {
  it('npm ci failing falls back to npm install with a ::warning::', async () => {
    file('pkg/package.json');
    file('pkg/package-lock.json');
    const calls = wire(['npm ci']);

    expect(await npmBuild(...row('pkg'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toEqual([
      'npm ci',
      'npm install',
      'npm run build --if-present',
    ]);
    expect(out.join('')).toMatch(/^::warning::package-lock\.json drift.*falling back to npm install$/m);
  });

  it('pnpm --frozen-lockfile failing falls back to --no-frozen-lockfile with a ::warning::', async () => {
    file('pnpm-workspace.yaml', "packages: ['packages/*']\n");
    file('packages/a/package.json');
    const calls = wire(['pnpm install --frozen-lockfile']);

    expect(await npmBuild(...row('packages/a'))).toBe(0);

    expect(calls.map((c) => c.argv.join(' '))).toEqual([
      'npm install -g pnpm@11',
      'pnpm install --frozen-lockfile',
      'pnpm install --no-frozen-lockfile',
      'npm run build --if-present',
    ]);
    expect(out.join('')).toMatch(/^::warning::pnpm-lock\.yaml drift.*--no-frozen-lockfile$/m);
  });

  it('a lenient install that also fails fails the command without building', async () => {
    file('pkg/package.json');
    file('pkg/package-lock.json');
    const calls = wire(['npm ci', 'npm install']);

    expect(await npmBuild(...row('pkg'))).toBe(1);

    expect(calls.map((c) => c.argv.join(' '))).not.toContain('npm run build --if-present');
  });

  it('a failing build fails the command', async () => {
    file('pkg/package.json');
    wire(['npm run build --if-present']);

    expect(await npmBuild(...row('pkg'))).toBe(1);
  });
});

describe('npm-build: build environment', () => {
  it('hands the build script TARGET, BUILD and VERSION from the row', async () => {
    file('pkg/package.json');
    const calls = wire();

    expect(await npmBuild(...row('pkg'))).toBe(0);

    const build = calls.at(-1)!;
    expect(build.cwd).toBe(join(root, 'pkg'));
    expect(build.env).toMatchObject({ TARGET: 'linux-x64-gnu', BUILD: 'napi', VERSION: '1.2.3' });
  });

  it('requires --target and --version for a single package', async () => {
    file('pkg/package.json');
    const calls = wire();

    expect(await npmBuild('--path', 'pkg', '--version', '1.2.3')).toBe(1);
    expect(await npmBuild('--path', 'pkg', '--target', 'main')).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe('npm-build --matrix: the publish-time rebuild', () => {
  it('builds each npm path once as TARGET=main with an empty BUILD, skipping other kinds', async () => {
    file('pnpm-workspace.yaml', "packages: ['packages/*']\n");
    file('packages/a/package.json');
    file('packages/b/package.json');
    file('packages/b/package-lock.json');
    const matrix = JSON.stringify([
      { name: 'a', kind: 'npm', path: 'packages/a', target: 'main', build: 'napi', version: '1.0.0' },
      { name: 'a-linux', kind: 'npm', path: 'packages/a', target: 'linux-x64-gnu', build: 'napi', version: '1.0.0' },
      { name: 'b', kind: 'npm', path: 'packages/b', target: 'main', version: '2.0.0' },
      { name: 'c', kind: 'crates', path: 'crates/c', target: 'noarch', version: '3.0.0' },
    ]);
    const calls = wire();

    expect(await npmBuild('--matrix', matrix)).toBe(0);

    expect(calls.map((c) => `${c.cwd} ${c.argv.join(' ')}`)).toEqual([
      expect.stringMatching(/ npm install -g pnpm@11$/),
      `${join(root, 'packages/a')} pnpm install --frozen-lockfile`,
      `${join(root, 'packages/a')} npm run build --if-present`,
      `${join(root, 'packages/b')} npm ci`,
      `${join(root, 'packages/b')} npm run build --if-present`,
    ]);
    const builds = calls.filter((c) => c.argv.includes('run'));
    expect(builds[0]!.env).toMatchObject({ TARGET: 'main', BUILD: '', VERSION: '1.0.0' });
    expect(builds[1]!.env).toMatchObject({ TARGET: 'main', BUILD: '', VERSION: '2.0.0' });
  });

  it('stops at the first package whose install fails', async () => {
    file('packages/a/package.json');
    file('packages/b/package.json');
    const matrix = JSON.stringify([
      { name: 'a', kind: 'npm', path: 'packages/a', target: 'main', version: '1.0.0' },
      { name: 'b', kind: 'npm', path: 'packages/b', target: 'main', version: '2.0.0' },
    ]);
    const calls = wire(['npm install']);

    expect(await npmBuild('--matrix', matrix)).toBe(1);

    expect(calls.every((c) => c.cwd === join(root, 'packages/a'))).toBe(true);
  });
});
