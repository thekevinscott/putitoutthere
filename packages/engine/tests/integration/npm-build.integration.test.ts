import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof ChildProcess>()), spawn: vi.fn() }));

let root: string;
let calls: { line: string; cwd?: string; env?: NodeJS.ProcessEnv }[];
let out: string;

function npmBuild(files: string[], failing: string[], ...args: string[]): Promise<number> {
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '{}');
  }
  vi.mocked(spawn).mockImplementation(((cmd: string, a: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    calls.push({ line: [cmd, ...a].join(' '), ...opts });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', failing.includes([cmd, ...a].join(' ')) ? 1 : 0));
    return child;
  }) as unknown as typeof spawn);
  return run(['node', 'putitoutthere', 'npm-build', '--cwd', join(root, 'repo'), ...args]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piot-npm-build-'));
  calls = [];
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

const ROW = ['--path', 'ws/a', '--target', 'linux-x64-gnu', '--build', 'napi', '--version', '1.2.3'];
const BUILD = 'npm run build --if-present';

it.each([
  [['repo/ws/pnpm-workspace.yaml'], [], ['npm install -g pnpm@11', 'pnpm install --frozen-lockfile', BUILD]],
  [['repo/ws/pnpm-lock.yaml'], ['pnpm install --frozen-lockfile'], ['npm install -g pnpm@11', 'pnpm install --frozen-lockfile', 'pnpm install --no-frozen-lockfile', BUILD]],
  [['repo/package-lock.json', 'repo/ws/a/pnpm-lock.yaml'], [], ['npm install -g pnpm@11', 'pnpm install --frozen-lockfile', BUILD]],
  [['repo/ws/package-lock.json'], ['npm ci'], ['npm ci', 'npm install', BUILD]],
  [['pnpm-lock.yaml'], [], ['npm install', BUILD]],
  [['repo/ws/package-lock.json'], ['npm ci', 'npm install'], ['npm ci', 'npm install']],
])('%j failing %j runs %j in the package dir', async (files, failing, expected) => {
  expect(await npmBuild(files, failing, ...ROW)).toBe(expected.includes(BUILD) ? 0 : 1);
  expect(calls.map((c) => c.line)).toEqual(expected);
  expect(calls.every((c) => c.cwd === join(root, 'repo/ws/a'))).toBe(true);
  expect(out.includes('::warning::')).toBe(failing.length > 0);
});

it('hands the build TARGET, BUILD and VERSION, per row or as main for --matrix', async () => {
  const matrix = JSON.stringify([
    { kind: 'npm', path: 'ws/a', target: 'main', version: '1.0.0' },
    { kind: 'npm', path: 'ws/a', target: 'linux-x64-gnu', build: 'napi', version: '1.0.0' },
    { kind: 'pypi', path: 'py', target: 'sdist', version: '2.0.0' },
  ]);
  expect(await npmBuild([], [], ...ROW)).toBe(0);
  expect(await npmBuild([], [], '--matrix', matrix)).toBe(0);
  expect(calls.filter((c) => c.line === BUILD).map((c) => [c.cwd, c.env?.TARGET, c.env?.BUILD, c.env?.VERSION])).toEqual([
    [join(root, 'repo/ws/a'), 'linux-x64-gnu', 'napi', '1.2.3'],
    [join(root, 'repo/ws/a'), 'main', '', '1.0.0'],
  ]);
});
