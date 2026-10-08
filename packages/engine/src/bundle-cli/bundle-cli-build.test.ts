import { beforeEach, expect, it, vi } from 'vitest';

import { execInherit } from '../utils/exec-inherit.js';
import { bundleCliBuild } from './bundle-cli-build.js';

vi.mock('../utils/exec-inherit.js');

const TAIL = ['--bin', 'tool', '--target-dir', 'target'];
const build = (target: string, features = '', noDefaultFeatures = false): Promise<void> =>
  bundleCliBuild('/crate', { target, bin: 'tool', features, noDefaultFeatures });

beforeEach(() => {
  vi.mocked(execInherit).mockResolvedValue();
});

it.each([
  ['x86_64-unknown-linux-gnu', ['zigbuild', '--release', '--target', 'x86_64-unknown-linux-gnu.2.17', ...TAIL]],
  ['armv7-unknown-linux-gnueabihf', ['zigbuild', '--release', '--target', 'armv7-unknown-linux-gnueabihf.2.17', ...TAIL]],
  ['aarch64-unknown-linux-musl', ['zigbuild', '--release', '--target', 'aarch64-unknown-linux-musl', ...TAIL]],
  ['aarch64-apple-darwin', ['build', '--release', '--target', 'aarch64-apple-darwin', ...TAIL]],
  ['x86_64-pc-windows-msvc', ['build', '--release', '--target', 'x86_64-pc-windows-msvc', ...TAIL]],
])('%s runs cargo %j in the crate dir', async (target, args) => {
  await build(target);
  expect(execInherit).toHaveBeenCalledWith('cargo', args, { cwd: '/crate' });
});

it('appends features and --no-default-features after the base invocation', async () => {
  await build('aarch64-apple-darwin', 'a,b', true);
  expect(vi.mocked(execInherit).mock.calls[0]?.[1]).toEqual([
    'build', '--release', '--target', 'aarch64-apple-darwin', ...TAIL, '--features', 'a,b', '--no-default-features',
  ]);
});

it('propagates a cargo failure', async () => {
  vi.mocked(execInherit).mockRejectedValue(new Error('Command failed: cargo build'));
  await expect(build('aarch64-apple-darwin')).rejects.toThrow('Command failed: cargo build');
});
