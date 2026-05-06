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
 * Lives in `test/integration/` so the unit-test config doesn't pick
 * it up. Invoked via `pnpm run test:integration`.
 *
 * Issue #280.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';

// Capture the real execFileSync from the mock factory so we can
// delegate to it for non-npm subprocesses (git, etc.). `vi.hoisted`
// shares mutable state across `vi.mock` (hoisted to top of file) and
// the rest of module setup.
const real = vi.hoisted(() => ({ execFileSync: undefined as unknown as typeof execFileSync }));

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  real.execFileSync = actual.execFileSync;
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

let repo: string;

function gitInRepo(args: string[]): void {
  real.execFileSync('git', args, { cwd: repo });
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
  execMock.mockImplementation(((cmd: string, args: readonly string[], opts?: unknown) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        throw Object.assign(new Error('E404'), {
          status: 1,
          stderr: Buffer.from('404 not found'),
        });
      }
      if (a[0] === 'publish') return Buffer.from('');
    }
    return real.execFileSync(cmd, args as readonly string[], opts as Parameters<typeof execFileSync>[2]);
  }) as typeof execFileSync);

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
