import { beforeEach, describe, expect, it, vi } from 'vitest';

import { execInherit } from '../utils/exec-inherit.js';
import { runTool, toolArgv } from './run-tool.js';

vi.mock('../utils/exec-inherit.js');

const inherit = vi.mocked(execInherit);

beforeEach(() => {
  inherit.mockReset();
});

describe('toolArgv', () => {
  it('runs the tool directly off Windows', () => {
    expect(toolArgv('npm', ['ci'], 'linux')).toEqual(['npm', ['ci']]);
    expect(toolArgv('pnpm', ['install', '--frozen-lockfile'], 'darwin')).toEqual(['pnpm', ['install', '--frozen-lockfile']]);
  });

  it('goes through cmd.exe on Windows, where npm and pnpm are .cmd shims', () => {
    expect(toolArgv('npm', ['ci'], 'win32')).toEqual(['cmd.exe', ['/d', '/s', '/c', 'npm', 'ci']]);
  });
});

describe('runTool', () => {
  it('runs through the inherit seam with the platform argv and options', async () => {
    inherit.mockResolvedValue(undefined);
    await runTool('npm', ['run', 'build'], { cwd: '/pkg' });
    expect(inherit).toHaveBeenCalledWith(...toolArgv('npm', ['run', 'build'], process.platform), { cwd: '/pkg' });
  });

  it('propagates a failure', async () => {
    inherit.mockRejectedValue(new Error('Command failed: npm ci'));
    await expect(runTool('npm', ['ci'], {})).rejects.toThrow('Command failed: npm ci');
  });
});
