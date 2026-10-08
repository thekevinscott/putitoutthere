import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof ChildProcess>()), spawn: vi.fn() }));

const root = resolve('/repo');
let calls: { line: string; cwd?: string }[];
let err: string;

function build(exitCode: number, ...args: string[]): Promise<number> {
  vi.mocked(spawn).mockImplementation(((cmd: string, a: string[], opts: { cwd?: string }) => {
    calls.push({ line: [cmd, ...a].join(' '), cwd: opts.cwd });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', exitCode));
    return child;
  }) as unknown as typeof spawn);
  return run(['node', 'putitoutthere', 'bundle-cli-build', '--cwd', root, '--path', 'crates/cli', '--bin', 'tool', ...args]);
}

beforeEach(() => {
  calls = [];
  err = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => ((err += String(s)), true));
});

const TAIL = '--bin tool --target-dir target';

it.each([
  [['--target', 'x86_64-unknown-linux-gnu'], `cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.17 ${TAIL}`],
  [['--target', 'armv7-unknown-linux-gnueabihf'], `cargo zigbuild --release --target armv7-unknown-linux-gnueabihf.2.17 ${TAIL}`],
  [['--target', 'x86_64-unknown-linux-musl'], `cargo zigbuild --release --target x86_64-unknown-linux-musl ${TAIL}`],
  [['--target', 'aarch64-apple-darwin'], `cargo build --release --target aarch64-apple-darwin ${TAIL}`],
  [['--target', 'x86_64-pc-windows-msvc', '--features', 'a,b'], `cargo build --release --target x86_64-pc-windows-msvc ${TAIL} --features a,b`],
  [['--target', 'x86_64-unknown-linux-gnu', '--features', 'a', '--no-default-features'], `cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.17 ${TAIL} --features a --no-default-features`],
  [['--target', 'aarch64-apple-darwin', '--features', ''], `cargo build --release --target aarch64-apple-darwin ${TAIL}`],
])('%j runs `%s` in the crate dir', async (args, expected) => {
  expect(await build(0, ...args)).toBe(0);
  expect(calls).toEqual([{ line: expected, cwd: join(root, 'crates/cli') }]);
});

it('fails when cargo fails', async () => {
  expect(await build(101, '--target', 'aarch64-apple-darwin')).toBe(1);
  expect(err).toContain('cargo build --release --target aarch64-apple-darwin');
});

it('requires --target', async () => {
  expect(await build(0)).toBe(1);
  expect(calls).toEqual([]);
  expect(err).toContain('bundle-cli-build: --path, --target and --bin are required');
});
