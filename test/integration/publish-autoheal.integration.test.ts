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

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';

const real = vi.hoisted(() => ({ execFileSync: undefined as unknown as typeof execFileSync }));

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  real.execFileSync = actual.execFileSync;
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

let repo: string;

function gitInRepo(args: string[]): string {
  return real.execFileSync('git', args, { cwd: repo, encoding: 'utf8' }) as string;
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
      if (a[0] === 'view') {return Buffer.from('0.1.0');}
      if (a[0] === 'publish') {return Buffer.from('');}
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
