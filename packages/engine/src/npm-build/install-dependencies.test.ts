import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDependencies } from './install-dependencies.js';
import { runTool } from './run-tool.js';

vi.mock('./run-tool.js');

const tool = vi.mocked(runTool);
let out: string[];

function failOn(...commands: string[]): string[] {
  const calls: string[] = [];
  tool.mockImplementation((name, args) => {
    const line = [name, ...args].join(' ');
    calls.push(line);
    return commands.includes(line) ? Promise.reject(new Error(`Command failed: ${line}`)) : Promise.resolve();
  });
  return calls;
}

beforeEach(() => {
  tool.mockReset();
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    out.push(String(s));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installDependencies', () => {
  it('none: a bare npm install in the package dir', async () => {
    const calls = failOn();
    await installDependencies('/pkg', 'none');
    expect(calls).toEqual(['npm install']);
    expect(tool).toHaveBeenCalledWith('npm', ['install'], { cwd: '/pkg' });
  });

  it('npm: npm ci, with no warning when it succeeds', async () => {
    const calls = failOn();
    await installDependencies('/pkg', 'npm');
    expect(calls).toEqual(['npm ci']);
    expect(tool).toHaveBeenCalledWith('npm', ['ci'], { cwd: '/pkg' });
    expect(out).toEqual([]);
  });

  it('npm: falls back to npm install with a warning when npm ci fails', async () => {
    const calls = failOn('npm ci');
    await installDependencies('/pkg', 'npm');
    expect(calls).toEqual(['npm ci', 'npm install']);
    expect(tool).toHaveBeenLastCalledWith('npm', ['install'], { cwd: '/pkg' });
    expect(out).toEqual([
      '::warning::package-lock.json drift (likely 404 on platform-package optionalDependencies for a brand-new bundled-cli/napi family); falling back to npm install\n',
    ]);
  });

  it('pnpm: installs pnpm@11 first, then a frozen install', async () => {
    const calls = failOn();
    await installDependencies('/pkg', 'pnpm');
    expect(calls).toEqual(['npm install -g pnpm@11', 'pnpm install --frozen-lockfile']);
    expect(tool).toHaveBeenCalledWith('npm', ['install', '-g', 'pnpm@11'], { cwd: '/pkg' });
    expect(tool).toHaveBeenCalledWith('pnpm', ['install', '--frozen-lockfile'], { cwd: '/pkg' });
    expect(out).toEqual([]);
  });

  it('pnpm: falls back to --no-frozen-lockfile with a warning', async () => {
    const calls = failOn('pnpm install --frozen-lockfile');
    await installDependencies('/pkg', 'pnpm');
    expect(calls.at(-1)).toBe('pnpm install --no-frozen-lockfile');
    expect(tool).toHaveBeenLastCalledWith('pnpm', ['install', '--no-frozen-lockfile'], { cwd: '/pkg' });
    expect(out).toEqual([
      '::warning::pnpm-lock.yaml drift (likely 404 on platform-package optionalDependencies for a brand-new bundled-cli/napi family); falling back to pnpm install --no-frozen-lockfile\n',
    ]);
  });

  it('a failing lenient install propagates', async () => {
    failOn('npm ci', 'npm install');
    await expect(installDependencies('/pkg', 'npm')).rejects.toThrow('Command failed: npm install');
  });

  it('a failing pnpm@11 install propagates without trying pnpm', async () => {
    const calls = failOn('npm install -g pnpm@11');
    await expect(installDependencies('/pkg', 'pnpm')).rejects.toThrow('pnpm@11');
    expect(calls).toEqual(['npm install -g pnpm@11']);
  });
});
