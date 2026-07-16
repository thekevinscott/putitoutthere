/**
 * Publish-path auto-heal (#407) — integration test (the deterministic
 * CI red gate; the e2e twin shells out to the real CLI against a live
 * fixture).
 *
 * The bug: when a version is already live on the registry but has no git
 * tag, `publish()`'s per-package loop skips it (`isPublished → continue`)
 * *before* the tag-creation block — so the missing tag never heals and
 * the package stays stuck (the #403 incident).
 *
 * This drives the real `publish()` + the real npm handler with only the
 * npm CLI subprocess mocked (same seam as `publish.integration.test.ts`).
 * `npm view` is mocked to SUCCEED, so `isPublished` returns true and the
 * package takes the skip path. The contract: publish must still write
 * the package's tag — without re-publishing.
 *
 * Red before the fix: the skip path creates no tag.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';
import { execCapture } from '../../src/utils/exec-capture.js';

// Dual-mock window: the npm handler + plan()'s git reads both flow
// through the process seam (`execCapture`). Intercept `npm` here and
// delegate everything else — `git` in particular — to the real
// `execCapture` so plan()'s git reads and the tag-write heal run against
// the real fixture repo.
type ExecCapture = typeof execCapture;
const real = vi.hoisted(() => ({ execCapture: undefined as unknown as ExecCapture }));

vi.mock('../../src/utils/exec-capture.js', async (orig) => {
  const actual = await orig<typeof import('../../src/utils/exec-capture.js')>();
  real.execCapture = actual.execCapture;
  return { ...actual, execCapture: vi.fn(actual.execCapture) };
});

const execMock = vi.mocked(execCapture);

let repo: string;

function gitInRepo(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
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
  repo = mkdtempSync(join(tmpdir(), 'piot-autoheal-int-'));

  // npm `view` SUCCEEDS -> the version looks already-published, so the
  // package takes the skip path; `npm publish` should never be invoked.
  execMock.mockImplementation(((cmd: string, args: readonly string[], opts?: unknown) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {return Promise.resolve({ stdout: '0.1.0', stderr: '' });}
      if (a[0] === 'publish') {return Promise.resolve({ stdout: '', stderr: '' });}
    }
    return real.execCapture(cmd, args, opts as Parameters<ExecCapture>[2]);
  }) as ExecCapture);

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('packages/ts/index.ts', 'x');
  writeRepoFile(
    'packages/ts/package.json',
    JSON.stringify({
      name: 'lib-js',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }),
  );
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  process.env.NODE_AUTH_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  execMock.mockReset();
});

describe('publish-path auto-heal (#407)', () => {
  it('writes the missing tag for an already-published version without re-publishing', async () => {
    // First release => planned version is first_version (0.1.0). `npm
    // view` reports it already live, so publish takes the skip path.
    const result = await publish({ cwd: repo });

    // It must NOT have re-published...
    const npmPublishCalls = execMock.mock.calls.filter(
      ([cmd, args]) =>
        cmd === 'npm' && Array.isArray(args) && (args as string[])[0] === 'publish',
    );
    expect(npmPublishCalls).toHaveLength(0);
    expect(result.published).toHaveLength(0);

    // ...but it must have healed the missing tag.
    const tags = gitInRepo(['tag', '-l']);
    expect(tags).toContain('lib-js-v0.1.0');
  });
});
