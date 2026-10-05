/**
 * Nested bundled-cli artifacts (#626): `synthesizePlatformPackage` takes `main`
 * from the first non-`package.json` `readdir` entry — the directory `bin` on
 * the nested layout — so #365's chmod lands there and the tarball ships the
 * binary 0644. Assertions read the staging dir before the engine deletes it.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';

// Integration tests run the first-party exec seam for real and mock only
// the Node built-in underneath it — `execFile` (what `execCapture` uses).
// Mocking the seam module itself would trip the testing-conventions
// `no-first-party-mock` gate. `npm` is intercepted here; `git` delegates to
// the real binary so `plan()`'s log/rev-parse work against the fixture repo.
const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

const PKG = 'nested-cli';
const BIN = 'nested-cli-bin';
const TRIPLE = 'linux-x64-gnu';
const PLATFORM_PKG = `${PKG}-${TRIPLE}`;
const VERSION = '0.0.1';

/** What the engine staged for one `npm publish <folder>` invocation. */
interface StagedPublish {
  name: string;
  main: string;
  /** Mode of the staged binary at its known nested path. Read from the
   *  path rather than from `main` on purpose: with the bug, `main` names
   *  the `bin` directory, and directories carry +x anyway — an assertion
   *  chasing `main` would pass on the broken output. */
  binMode: number;
}

let repo: string;
let remote: string;
let staged: StagedPublish[];

/** A minimal execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

/** `npm publish [--flags] <folder>` — the folder is the lone trailing
 *  non-flag arg (#305). */
function stagingDirArg(args: string[]): string | undefined {
  for (let i = args.length - 1; i >= 1; i -= 1) {
    const a = args[i]!;
    if (!a.startsWith('-')) {return a;}
  }
  return undefined;
}

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

const TOML = `
[putitoutthere]
version = 1

[[package]]
name    = "${PKG}"
kind    = "npm"
path    = "packages/cli"
globs   = ["packages/cli/**"]
build   = "bundled-cli"
targets = ["${TRIPLE}"]
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-nested-cli-int-'));
  staged = [];

  execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
        return fakeChild(1);
      }
      if (a[0] === 'publish') {
        // Snapshot what npm would pack: the staging dir is deleted as
        // soon as this call returns.
        const folder = stagingDirArg(a);
        if (folder !== undefined) {
          const manifest = JSON.parse(
            readFileSync(join(folder, 'package.json'), 'utf8'),
          ) as { name: string; main: string };
          staged.push({
            name: manifest.name,
            main: manifest.main,
            binMode: statSync(join(folder, 'bin', BIN)).mode,
          });
        }
        cb(null, '', '');
        return fakeChild(0);
      }
    }
    return (realExecFile as unknown as (...a: unknown[]) => ChildProcess.ChildProcess)(cmd, args, opts, cb);
  }) as unknown as typeof execFile);

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);
  // ensureTag (#717) now requires a real push to succeed before it
  // considers a release tagged; give it a real, local `origin` to push to.
  remote = mkdtempSync(join(tmpdir(), 'piot-nested-cli-int-remote-'));
  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote });
  gitInRepo(['remote', 'add', 'origin', remote]);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile(
    'packages/cli/package.json',
    JSON.stringify({
      name: PKG,
      version: '0.0.0',
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      bin: { [BIN]: 'bin/launcher.js' },
    }),
  );
  writeRepoFile('packages/cli/bin/launcher.js', '#!/usr/bin/env node\n');

  // The main row's artifact — a bundled-cli plan always emits one.
  writeRepoFile(`artifacts/${PKG}-main/package.json`, '{}\n');

  // The per-target artifact, binary NESTED under `bin/`. 0644 mirrors what
  // the Actions artifact upload/download boundary leaves behind (#365).
  writeRepoFile(`artifacts/${PLATFORM_PKG}/bin/${BIN}`, '#!/bin/sh\necho nested\n');
  chmodSync(join(repo, 'artifacts', PLATFORM_PKG, 'bin', BIN), 0o644);

  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  process.env.NODE_AUTH_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  execMock.mockReset();
});

describe('bundled-cli platform synthesis with a nested binary (#626)', () => {
  it('points `main` at the binary, not at the directory holding it', async () => {
    await publish({ cwd: repo, releasePackages: `${PKG}@${VERSION}` });

    const platform = staged.find((s) => s.name === PLATFORM_PKG);
    expect(platform, `staged: ${JSON.stringify(staged)}`).toBeDefined();
    expect(platform!.main).toBe(`bin/${BIN}`);
  });

  // Skipped on Windows: NTFS carries no POSIX execute bits, so the mode
  // the fix sets is unobservable there. npm platform publishes run on
  // Linux runners; the ubuntu leg exercises this.
  it.skipIf(process.platform === 'win32')('restores the executable bit on the nested binary', async () => {
    await publish({ cwd: repo, releasePackages: `${PKG}@${VERSION}` });

    const platform = staged.find((s) => s.name === PLATFORM_PKG);
    expect(platform, `staged: ${JSON.stringify(staged)}`).toBeDefined();
    expect(
      platform!.binMode & 0o111,
      `mode was 0${platform!.binMode.toString(8)} on bin/${BIN}`,
    ).not.toBe(0);
  });
});
