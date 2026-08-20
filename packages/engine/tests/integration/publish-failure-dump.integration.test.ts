/**
 * The failure dump carries the failing subprocess, not a paraphrase of it.
 *
 * Second half of #617. When a handler throws, `publish()` builds a
 * `FailureContext` for `dumpFailure` — the job-summary markdown a consumer
 * reads to find out what went wrong. It was populated from `error.message`
 * with `command: []` and `exitCode: -1`, so the dump described the engine's
 * own rendered sentence rather than the tool's output: on the run that
 * produced #617 the summary carried an empty command, an empty stderr and
 * exit code -1, and npm's raw 403 — the one line naming *why* the publish
 * was refused — never reached the operator at all.
 *
 * The seam is `ExecError`: it already holds the real stdout, stderr and
 * exit status, and the handler wraps it as the `cause` of whatever it
 * throws. This pins that the dump reads through to it.
 *
 * Same harness as `publish.integration.test.ts`: a real git repo, real
 * config load / plan / preflight / handler dispatch, with only the npm CLI
 * subprocess stubbed. Issue #617.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';

// Dual-mock window: see publish.integration.test.ts. Intercept `npm`;
// delegate `git` to the real binary so plan() works against the fixture repo.
const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

// Distinctive strings. Neither can reach the dump through `error.message`
// — the handler renders only stderr into its message, and never stdout —
// so finding them there proves the dump read the ExecError itself.
const NPM_STDOUT = 'npm-stdout-marker-2f7a';
const NPM_STDERR = [
  'npm error code E403',
  'npm error 403 403 Forbidden - PUT https://registry.npmjs.org/lib-js - Some registry-side refusal',
].join('\n');
const NPM_EXIT_CODE = 7;

let repo: string;
let summaryPath: string;

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
  repo = mkdtempSync(join(tmpdir(), 'piot-failure-dump-int-'));
  summaryPath = join(repo, 'step-summary.md');
  writeFileSync(summaryPath, '', 'utf8');

  execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
        return fakeChild(1);
      }
      if (a[0] === 'publish') {
        cb(Object.assign(new Error('Command failed'), { code: NPM_EXIT_CODE }), NPM_STDOUT, NPM_STDERR);
        return fakeChild(NPM_EXIT_CODE);
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
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  delete process.env.GITHUB_STEP_SUMMARY;
  execMock.mockReset();
});

/**
 * The contents of the dump's `**stderr**` fenced block. The renderer emits
 * a `**stderr**` label, an opening fence, the body, and a closing fence.
 */
function stderrBlockOf(summary: string): string {
  const after = summary.split('**stderr**')[1] ?? '';
  return (after.split('```')[1] ?? '').trim();
}

/** Run publish(), expect it to fail, and return the rendered job summary. */
async function summaryOfFailedPublish(): Promise<string> {
  await expect(publish({ cwd: repo })).rejects.toThrow();
  return readFileSync(summaryPath, 'utf8');
}

describe('failure dump reads through to the failing subprocess (#617)', () => {
  it('reports the exit code npm actually exited with, not -1', async () => {
    expect(await summaryOfFailedPublish()).toContain(`**Exit code.** \`${NPM_EXIT_CODE}\``);
  });

  it('reports the command that failed, not an empty argv', async () => {
    // `command: []` rendered as an empty code fence — a dump that says a
    // publish failed without saying what ran.
    expect(await summaryOfFailedPublish()).toContain('npm publish --access=public');
  });

  it("puts npm's stderr in the stderr block, not the engine's rendered sentence", async () => {
    // `toContain(NPM_STDERR)` would pass without the fix: the handler
    // renders stderr into its own message, and that message was what the
    // stderr slot held. Pin the block's exact contents instead.
    expect(stderrBlockOf(await summaryOfFailedPublish())).toBe(NPM_STDERR);
  });

  it("carries npm's stdout, which the thrown message never held", async () => {
    // The strongest pin on the threading: no rendered error message in the
    // engine has ever included subprocess stdout, so this can only arrive
    // via the ExecError.
    expect(await summaryOfFailedPublish()).toContain(NPM_STDOUT);
  });
});
