import { join, resolve } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

import { execInherit } from '../utils/exec-inherit.js';
import { pathExists } from '../utils/path-exists.js';
import { npmBuildPackage } from './npm-build-package.js';

vi.mock('../utils/exec-inherit.js');
vi.mock('../utils/path-exists.js');

const root = resolve('/repo');
const pkg = join(root, 'pkg');
let out: string;

function setup(files: string[], failing: string[] = []): string[] {
  vi.mocked(pathExists).mockImplementation((p) => Promise.resolve(files.map((f) => join(root, f)).includes(p)));
  const calls: string[] = [];
  vi.mocked(execInherit).mockImplementation((cmd, args) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    return failing.includes(line) ? Promise.reject(new Error(line)) : Promise.resolve();
  });
  return calls;
}

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
});

const BUILD = 'npm run build --if-present';
const PNPM = ['npm install -g pnpm@11', 'pnpm install --frozen-lockfile', BUILD];
const DRIFT = 'drift (likely 404 on platform-package optionalDependencies for a brand-new bundled-cli/napi family); falling back to';

it.each([
  [['pkg/package-lock.json', 'pkg/pnpm-lock.yaml'], [], ['npm ci', BUILD]],
  [['pnpm-lock.yaml'], [], PNPM],
  [['pkg/pnpm-workspace.yaml', 'package-lock.json'], [], PNPM],
  [['../package-lock.json'], [], ['npm install', BUILD]],
  [[], [], ['npm install', BUILD]],
  [['pkg/package-lock.json'], ['npm ci'], ['npm ci', 'npm install', BUILD], `::warning::package-lock.json ${DRIFT} npm install\n`],
  [['pnpm-workspace.yaml'], ['pnpm install --frozen-lockfile'], [...PNPM.slice(0, 2), 'pnpm install --no-frozen-lockfile', BUILD], `::warning::pnpm-lock.yaml ${DRIFT} pnpm install --no-frozen-lockfile\n`],
])('%j failing %j runs %j', async (files, failing, expected, warning = '') => {
  const calls = setup(files, failing);
  await npmBuildPackage(pkg, root, { TARGET: 't' });
  expect(calls).toEqual(expected);
  expect(out).toBe(warning);
  expect(vi.mocked(execInherit)).toHaveBeenLastCalledWith('npm', ['run', 'build', '--if-present'], { cwd: pkg, env: expect.objectContaining({ TARGET: 't', PATH: process.env.PATH }) as unknown });
});

it('stops when the lenient install fails, and spawns through cmd.exe on Windows', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const calls = setup(['pkg/package-lock.json'], ['cmd.exe /d /s /c npm ci', 'cmd.exe /d /s /c npm install']);
  await expect(npmBuildPackage(pkg, root, {})).rejects.toThrow('npm install');
  expect(calls).toEqual(['cmd.exe /d /s /c npm ci', 'cmd.exe /d /s /c npm install']);
  expect(vi.mocked(execInherit)).toHaveBeenCalledWith('cmd.exe', ['/d', '/s', '/c', 'npm', 'ci'], { cwd: pkg });
});
