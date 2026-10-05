import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const TIMEOUT = 240_000;

let prefix: string;
let root: string;

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    npm_config_prefix: prefix,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    PATH: `${join(prefix, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  };
}

function write(rel: string, body: string): void {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
}

const BUILD_SCRIPT =
  'node -e "require(\'fs\').writeFileSync(\'build.json\', JSON.stringify({TARGET:process.env.TARGET,BUILD:process.env.BUILD,VERSION:process.env.VERSION}))"';

function pkg(rel: string, extra: Record<string, unknown> = {}): void {
  write(
    join(rel, 'package.json'),
    JSON.stringify({ name: rel === '.' ? 'root' : rel.replace(/\W/g, '-'), version: '0.0.0', private: true, scripts: { build: BUILD_SCRIPT }, ...extra }),
  );
}

function sh(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
}

function npmBuild(cwd: string, args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [CLI, 'npm-build', '--cwd', cwd, ...args], {
      encoding: 'utf8',
      env: env(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

function built(rel: string): unknown {
  return JSON.parse(readFileSync(join(root, rel, 'build.json'), 'utf8'));
}

const ROW = ['--target', 'linux-x64-gnu', '--build', 'napi', '--version', '1.2.3'];

beforeAll(() => {
  prefix = mkdtempSync(join(tmpdir(), 'piot-npm-build-prefix-'));
  sh('npm', ['install', '-g', 'pnpm@11'], prefix);
}, TIMEOUT);

afterAll(() => {
  rmSync(prefix, { recursive: true, force: true });
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piot-npm-build-e2e-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('npm-build e2e', () => {
  it('a pnpm workspace member with an ancestor pnpm-lock.yaml installs with pnpm, frozen', () => {
    pkg('.', {});
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    pkg('packages/a');
    sh('pnpm', ['install'], root);
    rmSync(join(root, 'node_modules'), { recursive: true, force: true });

    const r = npmBuild(root, ['--path', 'packages/a', ...ROW]);

    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('::warning::');
    expect(existsSync(join(root, 'node_modules/.modules.yaml'))).toBe(true);
    expect(existsSync(join(root, 'packages/a/package-lock.json'))).toBe(false);
    expect(built('packages/a')).toEqual({ TARGET: 'linux-x64-gnu', BUILD: 'napi', VERSION: '1.2.3' });
  }, TIMEOUT);

  it('a member with only an ancestor pnpm-workspace.yaml installs with pnpm', () => {
    pkg('.', {});
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    pkg('packages/a');

    const r = npmBuild(root, ['--path', 'packages/a', ...ROW]);

    expect(r.code).toBe(0);
    expect(existsSync(join(root, 'pnpm-lock.yaml'))).toBe(true);
    expect(existsSync(join(root, 'node_modules/.modules.yaml'))).toBe(true);
    expect(existsSync(join(root, 'packages/a/package-lock.json'))).toBe(false);
  }, TIMEOUT);

  it('pnpm refusing a drifted lockfile falls back to --no-frozen-lockfile', () => {
    pkg('.', {});
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    pkg('packages/a');
    pkg('packages/b');
    sh('pnpm', ['install'], root);
    pkg('packages/a', { dependencies: { 'packages-b': 'workspace:*' } });

    const r = npmBuild(root, ['--path', 'packages/a', ...ROW]);

    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/::warning::pnpm-lock\.yaml drift.*--no-frozen-lockfile/);
    expect(existsSync(join(root, 'packages/a/node_modules/packages-b'))).toBe(true);
  }, TIMEOUT);

  it('a local package-lock.json installs with npm ci', () => {
    pkg('pkg');
    sh('npm', ['install'], join(root, 'pkg'));
    write('pkg/node_modules/sentinel', 'npm ci wipes node_modules; npm install would not');

    const r = npmBuild(root, ['--path', 'pkg', ...ROW]);

    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('::warning::');
    expect(existsSync(join(root, 'pkg/node_modules/sentinel'))).toBe(false);
    expect(built('pkg')).toEqual({ TARGET: 'linux-x64-gnu', BUILD: 'napi', VERSION: '1.2.3' });
  }, TIMEOUT);

  it('npm ci refusing a drifted lockfile falls back to npm install', () => {
    pkg('pkg');
    sh('npm', ['install'], join(root, 'pkg'));
    write('pkg/dep/package.json', JSON.stringify({ name: 'dep', version: '0.0.0' }));
    pkg('pkg', { dependencies: { dep: 'file:./dep' } });

    const r = npmBuild(root, ['--path', 'pkg', ...ROW]);

    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/::warning::package-lock\.json drift.*falling back to npm install/);
    expect(existsSync(join(root, 'pkg/node_modules/dep'))).toBe(true);
  }, TIMEOUT);

  it('nothing found falls back to a bare npm install', () => {
    pkg('pkg');

    const r = npmBuild(root, ['--path', 'pkg', ...ROW]);

    expect(r.code).toBe(0);
    expect(existsSync(join(root, 'pkg/package-lock.json'))).toBe(true);
    expect(built('pkg')).toEqual({ TARGET: 'linux-x64-gnu', BUILD: 'napi', VERSION: '1.2.3' });
  }, TIMEOUT);

  it('the walk stops at --cwd: a pnpm workspace above it is ignored', () => {
    write('pnpm-workspace.yaml', "packages:\n  - 'repo/*'\n");
    write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    pkg('repo/pkg');

    const r = npmBuild(join(root, 'repo'), ['--path', 'pkg', ...ROW]);

    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('pnpm');
    expect(existsSync(join(root, 'repo/pkg/package-lock.json'))).toBe(true);
  }, TIMEOUT);

  it('--matrix rebuilds each npm path once with TARGET=main', () => {
    pkg('a');
    pkg('b');
    const matrix = JSON.stringify([
      { name: 'a', kind: 'npm', path: 'a', target: 'main', build: 'napi', version: '1.0.0' },
      { name: 'a-linux', kind: 'npm', path: 'a', target: 'linux-x64-gnu', build: 'napi', version: '1.0.0' },
      { name: 'b', kind: 'npm', path: 'b', target: 'main', version: '2.0.0' },
      { name: 'c', kind: 'crates', path: 'c', target: 'noarch', version: '3.0.0' },
    ]);

    const r = npmBuild(root, ['--matrix', matrix]);

    expect(r.code).toBe(0);
    expect(built('a')).toEqual({ TARGET: 'main', BUILD: '', VERSION: '1.0.0' });
    expect(built('b')).toEqual({ TARGET: 'main', BUILD: '', VERSION: '2.0.0' });
  }, TIMEOUT);
});
