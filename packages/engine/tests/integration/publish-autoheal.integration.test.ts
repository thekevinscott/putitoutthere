/**
 * Publish-path auto-heal (#407, the #403 incident): a version already live
 * with no git tag is skipped by `publish()`'s loop (`isPublished → continue`)
 * *before* the tag-creation block, so the tag never heals. `npm view` is
 * mocked to SUCCEED so the package takes that skip path.
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
// testing-conventions `no-first-party-mock` gate. Intercept `npm` here and
// delegate everything else — `git` in particular — to the real `execFile`
// so plan()'s git reads and the tag-write heal run against the real fixture
// repo.
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
let remote: string;

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
  execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        cb(null, '0.1.0', '');
        return fakeChild(0);
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
  // ensureTag (#717) now requires a real push to succeed before it
  // considers a release tagged; give it a real, local `origin` to push to.
  remote = mkdtempSync(join(tmpdir(), 'piot-autoheal-int-remote-'));
  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote });
  gitInRepo(['remote', 'add', 'origin', remote]);

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
  rmSync(remote, { recursive: true, force: true });
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
