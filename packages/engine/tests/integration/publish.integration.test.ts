/**
 * `publish` pipeline integration test.
 *
 * Exercises the real `publish()` orchestration end-to-end against a
 * real git repo, the default `handlerFor` (so the *actual* npm
 * handler dispatches), and a fake npm registry implemented by
 * mocking `execFileSync` — same shape `npm.integration.test.ts`
 * uses. The only seam stubbed out is the npm CLI subprocess; every
 * piece of putitoutthere's own code (config loader, plan, preflight,
 * completeness, handler dispatch, npm handler body) runs verbatim.
 *
 * Lives in `tests/integration/` so the unit-test config doesn't pick
 * it up. Invoked via `pnpm run test:integration`.
 *
 * Issue #280.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';

// Dual-mock window: the npm handler + plan()'s git reads both flow through
// the first-party process seam (`execCapture`). Integration tests run that
// seam for real and mock only the Node built-in underneath it — `execFile`
// (what `execCapture` uses); mocking the seam module itself would trip the
// testing-conventions `no-first-party-mock` gate. Intercept `npm` here
// (canned registry responses) and delegate everything else — `git` in
// particular — to the real `execFile` so plan()'s `git log` / `git
// rev-parse` work against the real fixture repo.
const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

/** A minimal execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

let repo: string;

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
name  = "lib-js"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-publish-int-'));

  // Install a single dispatcher: npm calls return canned registry
  // responses; everything else (git, etc.) hits the real binary so
  // plan()'s `git log` / `git rev-parse` work against the real repo.
  execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
        return fakeChild(1);
      }
      if (a[0] === 'publish') {
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
  writeRepoFile('packages/ts/index.ts', 'x');
  // package.json deliberately lacks `repository` — that's the bug
  // surface. Override per-test where the well-formed shape is needed.
  writeRepoFile(
    'packages/ts/package.json',
    JSON.stringify({ name: 'lib-js', version: '0.0.0' }),
  );
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  // Auth: set a token so the auth preflight passes; the missing
  // `repository` is the only thing left to fail on.
  process.env.NODE_AUTH_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  execMock.mockReset();
});

describe('publish: end-to-end with real handlers + fake npm registry (#280)', () => {
  it('aborts at preflight when an npm package.json lacks a non-empty `repository` field', async () => {
    // Real handlers, real preflight, real plan. The only mocked seam
    // is the `npm` CLI subprocess. The bug #280 describes is exactly
    // this: putitoutthere should refuse before invoking npm at all,
    // because `npm publish --provenance` will fail with a confusing
    // tail-end error otherwise. We assert that:
    //   1. publish() rejects with the stable error code
    //   2. `npm publish` was never invoked
    await expect(publish({ cwd: repo })).rejects.toThrow(
      /PIOT_NPM_MISSING_REPOSITORY/,
    );

    const npmPublishCalls = execMock.mock.calls.filter(
      ([cmd, args]) =>
        cmd === 'npm' && Array.isArray(args) && (args as string[])[0] === 'publish',
    );
    expect(npmPublishCalls).toHaveLength(0);
  });

  it('sanity check: same pipeline succeeds when `repository` is well-formed', async () => {
    // Without this check, a regression that always-throws would also
    // satisfy the red test above — this pins the other half of the
    // contract.
    writeRepoFile(
      'packages/ts/package.json',
      JSON.stringify({
        name: 'lib-js',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
    );
    gitInRepo(['add', '-A']);
    gitInRepo(['commit', '-m', 'fix: add repository\n\nrelease: patch']);

    const result = await publish({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['lib-js']);

    // And `npm publish` *was* invoked this time.
    const npmPublishCalls = execMock.mock.calls.filter(
      ([cmd, args]) =>
        cmd === 'npm' && Array.isArray(args) && (args as string[])[0] === 'publish',
    );
    expect(npmPublishCalls.length).toBeGreaterThan(0);
  });
});
