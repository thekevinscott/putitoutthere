import { beforeEach, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { checkGnuLinkage } from './check-gnu-linkage.js';

vi.mock('../utils/exec-capture.js');

let out: string;

function tools(file: string, objdump: string): void {
  vi.mocked(execCapture).mockImplementation((cmd) =>
    Promise.resolve({ stdout: cmd === 'file' ? file : objdump, stderr: '' }),
  );
}

const DYNAMIC = '/b/tool: ELF 64-bit LSB pie executable, dynamically linked\n';

beforeEach(() => {
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
});

it('passes a dynamic binary within the floor, running file then objdump -T on it', async () => {
  tools(DYNAMIC, '(GLIBC_2.17) a\n(GLIBC_2.3.4) b\n');
  await expect(checkGnuLinkage('/b/tool', 'd/tool')).resolves.toBe(true);
  expect(vi.mocked(execCapture).mock.calls).toEqual([['file', ['/b/tool']], ['objdump', ['-T', '/b/tool']]]);
  expect(out).toBe('ok bundle_cli: d/tool is dynamically linked, glibc ceiling GLIBC_2.17 within GLIBC_2.17\n');
});

it('reports "none" when the binary carries no GLIBC_ requirement', async () => {
  tools(DYNAMIC, '');
  await expect(checkGnuLinkage('/b/tool', 'd/tool')).resolves.toBe(true);
  expect(out).toBe('ok bundle_cli: d/tool is dynamically linked, glibc ceiling none within GLIBC_2.17\n');
});

it('fails a binary above the floor', async () => {
  tools(DYNAMIC, '(GLIBC_2.18) a\n');
  await expect(checkGnuLinkage('/b/tool', 'd/tool')).resolves.toBe(false);
  expect(out).toBe(
    '::error::bundle_cli binary d/tool requires GLIBC_2.18, exceeding the GLIBC_2.17 portability floor — it would fail at runtime on distros older than the runner (#381, #605).\n',
  );
});

it.each(['statically linked', 'static-pie linked'])('fails a %s binary without reading its symbols', async (linkage) => {
  const file = `/b/tool: ELF 64-bit LSB executable, ${linkage}\n`;
  tools(file, '');
  await expect(checkGnuLinkage('/b/tool', 'd/tool')).resolves.toBe(false);
  expect(execCapture).toHaveBeenCalledTimes(1);
  expect(out).toBe(
    '::error::bundle_cli binary d/tool is statically linked — a static binary cannot dlopen, so SQLite extension loading fails at runtime (#605, dirsql#762). Expected a dynamically-linked gnu build pinned to GLIBC_2.17 via cargo-zigbuild.\n' +
      file,
  );
});

it('fails when `file` cannot run', async () => {
  vi.mocked(execCapture).mockRejectedValue(new Error('spawn file ENOENT'));
  await expect(checkGnuLinkage('/b/tool', 'd/tool')).resolves.toBe(false);
  expect(out).toBe("::error::required command 'file' not found on this runner — cannot assert linkage\n");
});

it('propagates an objdump failure', async () => {
  vi.mocked(execCapture).mockImplementation((cmd) =>
    cmd === 'file' ? Promise.resolve({ stdout: DYNAMIC, stderr: '' }) : Promise.reject(new Error('objdump failed')),
  );
  await expect(checkGnuLinkage('/b/tool', 'd/tool')).rejects.toThrow('objdump failed');
});
