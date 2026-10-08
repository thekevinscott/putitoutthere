import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof ChildProcess>()), execFile: vi.fn() }));

let root: string;
let calls: string[];
let out: string;

function tools(file: string | Error, objdump: string): void {
  vi.mocked(execFile).mockImplementation(((cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, so: string, se: string) => void) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'file' && file instanceof Error) {cb(file, '', '');}
    else {cb(null, cmd === 'file' ? file as string : objdump, '');}
  }) as unknown as typeof execFile);
}

function verify(platform: NodeJS.Platform, target: string, staged: string[] = ['tool']): Promise<number> {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  mkdirSync(join(root, 'pkg/build/t'), { recursive: true });
  for (const name of staged) {writeFileSync(join(root, 'pkg/build/t', name), 'bin');}
  return run(['node', 'putitoutthere', 'bundle-cli-verify', '--cwd', root, '--path', 'pkg/build/t', '--bin', 'tool', '--target', target]);
}

const GNU = 'x86_64-unknown-linux-gnu';
const DYNAMIC = 'ELF 64-bit LSB pie executable, x86-64, dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2';
const symbols = (...v: string[]): string => v.map((s) => `0000000000000000      DF *UND*  0000000000000000 (${s}) fn\n`).join('');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piot-bundle-cli-verify-'));
  calls = [];
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  tools(DYNAMIC, symbols('GLIBC_2.2.5', 'GLIBC_2.3.4', 'GLIBC_2.14'));
});

it('passes a dynamic gnu binary whose highest GLIBC_ requirement is within the 2.17 floor', async () => {
  expect(await verify('linux', GNU)).toBe(0);
  expect(calls).toEqual([`file ${join(root, 'pkg/build/t/tool')}`, `objdump -T ${join(root, 'pkg/build/t/tool')}`]);
  expect(out).toBe(
    'ok bundle_cli: pkg/build/t/tool present\n' +
    'ok bundle_cli: pkg/build/t/tool is dynamically linked, glibc ceiling GLIBC_2.14 within GLIBC_2.17\n',
  );
});

it('passes a binary that requires exactly GLIBC_2.17, and one with no GLIBC_ symbols', async () => {
  tools(DYNAMIC, symbols('GLIBC_2.17', 'GLIBC_2.4'));
  expect(await verify('linux', GNU)).toBe(0);
  expect(out).toContain('glibc ceiling GLIBC_2.17 within GLIBC_2.17');
  out = '';
  tools(DYNAMIC, '');
  expect(await verify('linux', GNU)).toBe(0);
  expect(out).toContain('glibc ceiling none within GLIBC_2.17');
});

it('fails a gnu binary that requires a glibc newer than the floor', async () => {
  tools(DYNAMIC, symbols('GLIBC_2.4', 'GLIBC_2.34', 'GLIBC_2.16'));
  expect(await verify('linux', GNU)).toBe(1);
  expect(out).toContain('::error::bundle_cli binary pkg/build/t/tool requires GLIBC_2.34, exceeding the GLIBC_2.17 portability floor');
});

it.each(['statically linked', 'static-pie linked'])('fails a %s gnu binary, which cannot dlopen', async (linkage) => {
  tools(`ELF 64-bit LSB executable, x86-64, ${linkage}, stripped`, '');
  expect(await verify('linux', GNU)).toBe(1);
  expect(out).toContain('::error::bundle_cli binary pkg/build/t/tool is statically linked — a static binary cannot dlopen');
  expect(out).toContain(`${linkage}, stripped`);
  expect(calls).toEqual([`file ${join(root, 'pkg/build/t/tool')}`]);
});

it('fails when `file` is not on the runner', async () => {
  tools(Object.assign(new Error('spawn file ENOENT'), { code: 'ENOENT' }), '');
  expect(await verify('linux', GNU)).toBe(1);
  expect(out).toContain("::error::required command 'file' not found on this runner — cannot assert linkage");
});

it('accepts a declared musl triple without the gnu-lane linkage checks', async () => {
  expect(await verify('linux', 'x86_64-unknown-linux-musl')).toBe(0);
  expect(calls).toEqual([]);
  expect(out).toContain('ok bundle_cli: pkg/build/t/tool targets musl — static linkage is expected here');
});

it.each([
  ['darwin' as const, 'aarch64-apple-darwin', 'tool', 'pkg/build/t/tool'],
  ['win32' as const, 'x86_64-pc-windows-msvc', 'tool.exe', 'pkg/build/t/tool.exe'],
])('on %s only checks the staged binary is present', async (platform, target, staged, shown) => {
  expect(await verify(platform, target, [staged])).toBe(0);
  expect(calls).toEqual([]);
  expect(out).toBe(`ok bundle_cli: ${shown} present\n`);
});

it('fails when the staged binary is missing, listing the dir', async () => {
  expect(await verify('win32', 'x86_64-pc-windows-msvc', ['tool', 'other'])).toBe(1);
  expect(out).toContain('::error::bundle_cli staged binary missing at pkg/build/t/tool.exe\n');
  expect(out).toContain('other');
});
