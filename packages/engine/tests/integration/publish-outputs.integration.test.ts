/**
 * `publish` → `$GITHUB_OUTPUT` integration test (#461).
 *
 * Drives the real CLI `run(['publish', ...])` against a real git repo,
 * the default `handlerFor` (the actual npm handler dispatches), and a
 * fake npm registry implemented by mocking `execFileSync` — the same
 * seam `publish.integration.test.ts` stubs. Every piece of
 * putitoutthere's own code runs verbatim: config loader, plan,
 * preflight, completeness, handler dispatch, tag formatting, and the
 * `$GITHUB_OUTPUT` write.
 *
 * The contract under test: when a release actually ships ≥ 1 package,
 * the publish command appends `released` / `released_packages` to
 * `$GITHUB_OUTPUT` so the reusable workflow can surface them as outputs
 * a consumer gates a post-release job on (issue #461). This asserts the
 * real file the runner would read, not a mock of it.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Mock only the Node built-in `execFile` underneath the first-party
// process seam (`execCapture`); the seam itself runs for real. Intercept
// `npm` (canned registry responses) and delegate everything else — `git`
// in particular — to the real `execFile` so plan()'s git reads work
// against the real fixture repo.
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
let ghOutput: string;

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
  repo = mkdtempSync(join(tmpdir(), 'piot-publish-outputs-int-'));
  ghOutput = join(repo, 'gha-output.txt');
  writeFileSync(ghOutput, '', 'utf8');

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
  process.env.GITHUB_OUTPUT = ghOutput;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  delete process.env.GITHUB_OUTPUT;
  execMock.mockReset();
});

describe('publish: $GITHUB_OUTPUT release facts (#461)', () => {
  it('appends released=true and released_packages with {name, version, tag} when a package ships', async () => {
    const code = await run(['node', 'putitoutthere', 'publish', '--cwd', repo]);
    expect(code).toBe(0);

    const out = readFileSync(ghOutput, 'utf8');
    expect(out).toMatch(/(^|\n)released=true\n/);

    const line = out.split('\n').find((l) => l.startsWith('released_packages='));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.slice('released_packages='.length)) as Array<{
      name: string;
      version: string;
      tag: string;
    }>;

    expect(parsed).toHaveLength(1);
    const [entry] = parsed;
    expect(entry!.name).toBe('lib-js');
    // A patch bump off 0.0.0 with no prior tag; assert semver shape
    // rather than the exact literal so the contract, not the bump math,
    // is what's pinned.
    expect(entry!.version).toMatch(/^\d+\.\d+\.\d+$/);
    // The tag is the canonical `formatTag` render of the default
    // `{name}-v{version}` template — surfaced from the publish path, not
    // reconstructed caller-side.
    expect(entry!.tag).toBe(`lib-js-v${entry!.version}`);
  });

  it('appends released=false and released_packages=[] on an idempotent re-run (already published)', async () => {
    // npm `view` now reports the version as live, so the publish path
    // takes the already-published skip branch and nothing newly ships.
    execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
      if (cmd === 'npm') {
        const a = args as string[];
        if (a[0] === 'view') {
          cb(null, '1.0.0\n', '');
          return fakeChild(0);
        }
        if (a[0] === 'publish') {
          cb(null, '', '');
          return fakeChild(0);
        }
      }
      return (realExecFile as unknown as (...a: unknown[]) => ChildProcess.ChildProcess)(cmd, args, opts, cb);
    }) as unknown as typeof execFile);

    const code = await run(['node', 'putitoutthere', 'publish', '--cwd', repo]);
    expect(code).toBe(0);

    const out = readFileSync(ghOutput, 'utf8');
    expect(out).toMatch(/(^|\n)released=false\n/);
    expect(out).toMatch(/(^|\n)released_packages=\[\]\n/);
  });
});
