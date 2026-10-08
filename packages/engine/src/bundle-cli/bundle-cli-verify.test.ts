import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

import { bundleCliVerify } from './bundle-cli-verify.js';
import { checkGnuLinkage } from './check-gnu-linkage.js';

vi.mock('node:fs/promises');
vi.mock('./check-gnu-linkage.js');

let out: string;

const verify = (platform: NodeJS.Platform, target: string): Promise<boolean> => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  return bundleCliVerify({ dir: '/abs/d', shownDir: 'd', bin: 'tool', target });
};

beforeEach(() => {
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
  vi.mocked(access).mockResolvedValue();
  vi.mocked(checkGnuLinkage).mockResolvedValue(true);
});

it('hands a present gnu binary on Linux to the linkage check and returns its verdict', async () => {
  vi.mocked(checkGnuLinkage).mockResolvedValue(false);
  await expect(verify('linux', 'x86_64-unknown-linux-gnu')).resolves.toBe(false);
  expect(access).toHaveBeenCalledWith(join('/abs/d', 'tool'));
  expect(checkGnuLinkage).toHaveBeenCalledWith(join('/abs/d', 'tool'), 'd/tool');
  expect(out).toBe('ok bundle_cli: d/tool present\n');
});

it('skips the linkage check for a declared musl triple', async () => {
  await expect(verify('linux', 'x86_64-unknown-linux-musl')).resolves.toBe(true);
  expect(checkGnuLinkage).not.toHaveBeenCalled();
  expect(out).toBe(
    'ok bundle_cli: d/tool present\n' +
      'ok bundle_cli: d/tool targets musl — static linkage is expected here; the dlopen / glibc-ceiling checks are gnu-lane only\n',
  );
});

it.each([
  ['darwin' as const, 'aarch64-apple-darwin', join('/abs/d', 'tool'), 'd/tool'],
  ['win32' as const, 'x86_64-pc-windows-msvc', join('/abs/d', 'tool.exe'), 'd/tool.exe'],
])('on %s checks presence only', async (platform, target, path, shown) => {
  await expect(verify(platform, target)).resolves.toBe(true);
  expect(access).toHaveBeenCalledWith(path);
  expect(checkGnuLinkage).not.toHaveBeenCalled();
  expect(out).toBe(`ok bundle_cli: ${shown} present\n`);
});

it('fails a missing binary, listing what the dir does hold', async () => {
  vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(readdir).mockResolvedValue(['a', 'b'] as never);
  await expect(verify('linux', 'x86_64-unknown-linux-gnu')).resolves.toBe(false);
  expect(readdir).toHaveBeenCalledWith('/abs/d');
  expect(out).toBe('::error::bundle_cli staged binary missing at d/tool\na\nb\n');
});

it('still fails cleanly when the dir itself is missing', async () => {
  vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
  await expect(verify('linux', 'x86_64-unknown-linux-gnu')).resolves.toBe(false);
  expect(out).toBe('::error::bundle_cli staged binary missing at d/tool\n');
});
