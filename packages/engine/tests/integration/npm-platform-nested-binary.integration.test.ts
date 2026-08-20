/**
 * Nested bundled-cli artifacts through the real `publish()` pipeline —
 * the deterministic twin of `npm-platform-nested-binary.e2e.test.ts`
 * (#626).
 *
 * A consumer's build step may stage the cross-compiled binary either flat
 * (`artifacts/<pkg>-<triple>/<bin>`) or nested under a subdirectory
 * (`artifacts/<pkg>-<triple>/bin/<bin>`). Both clear the completeness
 * check — it lists files recursively — so both reach
 * `synthesizePlatformPackage`, which picks the package's `main` by taking
 * the first non-`package.json` entry `readdir` returns. On the nested
 * layout that entry is the **directory** `bin`, so:
 *
 *   1. the synthesized manifest declares `"main": "bin"`, pointing at a
 *      directory (live casualty:
 *      `@agent-transcripts/x86_64-unknown-linux-gnu@0.0.1`), and
 *   2. the #365 executable-bit restore chmods that directory instead of
 *      the binary, so the tarball ships the binary at 0644 — exactly the
 *      condition #365 exists to prevent. Masked for consumers using a
 *      launcher that re-chmods at spawn time; an EACCES for anyone who
 *      execs the binary directly.
 *
 * Everything but the npm CLI runs for real: the config loader, `plan()`,
 * the pre-flights, handler dispatch, the npm handler body, and the
 * staging-directory synthesis on a real filesystem. Only `execFile` — the
 * Node built-in under the process seam — is mocked, so the assertions read
 * the staging directory npm *would* have packed, at the moment `npm
 * publish <folder>` is invoked (the engine deletes it right after).
 *
 * The e2e twin asserts the same two facts one fidelity up, on the bytes a
 * real `npm publish` PUT to a registry.
 *
 * Issue #626.
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
