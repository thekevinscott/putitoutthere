import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findInstaller } from './find-installer.js';
import { installDependencies } from './install-dependencies.js';
import { npmBuildPackage } from './npm-build-package.js';
import { runTool } from './run-tool.js';

vi.mock('./find-installer.js');
vi.mock('./install-dependencies.js');
vi.mock('./run-tool.js');

const find = vi.mocked(findInstaller);
const install = vi.mocked(installDependencies);
const tool = vi.mocked(runTool);
let out: string[];

const OPTS = { dir: '/repo/pkg', boundary: '/repo', target: 'linux-x64-gnu', build: 'napi', version: '1.2.3' };

beforeEach(() => {
  find.mockReset().mockResolvedValue('pnpm');
  install.mockReset().mockResolvedValue(undefined);
  tool.mockReset().mockResolvedValue(undefined);
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    out.push(String(s));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('npmBuildPackage', () => {
  it('installs with the installer found between dir and boundary, then builds', async () => {
    await npmBuildPackage(OPTS);
    expect(find).toHaveBeenCalledWith('/repo/pkg', '/repo');
    expect(install).toHaveBeenCalledWith('/repo/pkg', 'pnpm');
    expect(out.join('')).toBe('npm-build: /repo/pkg: installer pnpm\n');
    expect(tool).toHaveBeenCalledWith('npm', ['run', 'build', '--if-present'], {
      cwd: '/repo/pkg',
      env: expect.objectContaining({ TARGET: 'linux-x64-gnu', BUILD: 'napi', VERSION: '1.2.3' }) as unknown,
    });
  });

  it('keeps the rest of the environment for the build', async () => {
    vi.stubEnv('PIOT_SENTINEL', 'kept');
    await npmBuildPackage(OPTS);
    expect(tool.mock.calls[0]![2].env).toMatchObject({ PIOT_SENTINEL: 'kept' });
    vi.unstubAllEnvs();
  });

  it('does not build when the install fails', async () => {
    install.mockRejectedValue(new Error('Command failed: npm install'));
    await expect(npmBuildPackage(OPTS)).rejects.toThrow('npm install');
    expect(tool).not.toHaveBeenCalled();
  });
});
