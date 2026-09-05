/**
 * `piot plan` against an unreachable network — #650.
 *
 * A hermetic (`--network none`) `plan` run measured 70s against a 13-row
 * consumer matrix versus 0.95s with network, for a `matrix` output that is
 * byte-identical either way. Every second of that is the npm publish-verdict
 * probe: `isPublished` shells out to `npm view`, and the npm CLI's own
 * error-blind retry budget (`fetch-retries=2`, 10s then 60s) re-attempts a
 * DNS failure that cannot succeed. A name that does not resolve is
 * deterministic within a run — retrying it buys nothing.
 *
 * Two claims, one scenario:
 *
 * 1. **One bounded probe.** `npm view` is invoked exactly once, with npm's
 *    internal retry budget disabled, so an offline probe fails at DNS speed
 *    instead of paying a 70s backoff ladder. Asserted on the calls the
 *    engine makes rather than on elapsed time, which would be flaky in CI.
 * 2. **`unknown`, not `publish`.** Today every non-zero `npm view` exit —
 *    including "the network is gone" — is read as "the version is not on
 *    the registry", so an offline plan asserts a package WOULD PUBLISH when
 *    it could not reach npm to find out. That is exactly the release
 *    surprise `plan` exists to prevent. An unreachable registry must render
 *    UNKNOWN, the same posture crates.io and PyPI already take, and the
 *    matrix must still be emitted (the diagnostic degrades, never aborts).
 *
 * `unknown` keeps the release path intact: `unpublishedKinds` counts
 * unknown as unpublished (#622), so npm auth is still acquired for a run
 * whose verdict could not be resolved.
 *
 * Only the subprocess boundary is mocked — `execFile` underneath the real
 * process seam, and only for `npm`; git runs for real. Config, plan,
 * version, and handler dispatch are the real ones. This is the in-process
 * twin of `tests/e2e/plan-offline.e2e.test.ts`.
 */

import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { loadFixture } from './fixtures/load.js';

// Mock the Node built-in underneath the first-party seam, never the seam
// itself (testing-conventions `no-first-party-mock`).
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const actualChildProcess = await vi.importActual<typeof ChildProcess>('node:child_process');
const execMock = vi.mocked(execFile);

/** npm's stderr when the registry hostname does not resolve. */
const OFFLINE_STDERR = loadFixture('npm', 'view-enotfound-offline.txt');
/** npm's stderr when the registry answers, and the version is not there. */
const ABSENT_STDERR = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/demo-pkg\n';

/** A minimal execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

/** Every argv the engine handed to `npm`, in call order. */
let npmCalls: string[][] = [];

/**
 * Fail every `npm` invocation with `stderr`; pass everything else (git)
 * through to the real `execFile`.
 */
function wireNpmFailure(stderr: string): void {
  execMock.mockImplementation(((
    cmd: string,
    args: readonly string[],
    opts: unknown,
    cb: ExecCb,
  ) => {
    if (cmd !== 'npm') {
      return (actualChildProcess.execFile as unknown as (
        c: string, a: readonly string[], o: unknown, k: ExecCb,
      ) => ChildProcess.ChildProcess)(cmd, args, opts, cb);
    }
    npmCalls.push([...(args ?? [])]);
    cb(Object.assign(new Error(`Command failed: npm ${(args ?? []).join(' ')}`), { code: 1 }), '', stderr);
    return fakeChild(1);
  }) as unknown as typeof execFile);
}

let repo: string;
const stdoutChunks: string[] = [];

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

interface PlanJson {
  matrix: Array<{ name: string; kind: string }>;
  verdicts: Array<{ package: string; kind: string; version: string; verdict: string }>;
  skew: Array<{ dependent: string; dependency: string }>;
}

const NPM_PKG = `[putitoutthere]
version = 1

[[package]]
name  = "demo-npm"
kind  = "npm"
npm   = "demo-pkg"
path  = "packages/js"
globs = ["packages/js/**"]
`;

beforeEach(() => {
  npmCalls = [];
  execMock.mockReset();
  repo = mkdtempSync(join(tmpdir(), 'piot-plan-offline-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(repo, 'packages', 'js'), { recursive: true });
  writeFileSync(join(repo, 'packages', 'js', 'package.json'), '{"name":"demo-pkg","version":"0.0.0"}\n', 'utf8');
  writeFileSync(join(repo, 'putitoutthere.toml'), NPM_PKG, 'utf8');
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);

  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

async function planJson(): Promise<{ code: number; out: PlanJson }> {
  const code = await run([
    'node', 'piot', 'plan', '--json', '--cwd', repo,
    '--release-packages', 'demo-npm@1.2.3',
  ]);
  return { code, out: JSON.parse(stdoutChunks.join('')) as PlanJson };
}

describe('piot plan: hermetic run does not pay npm retries it cannot use (#650)', () => {
  it('probes npm exactly once, with npm\'s own retry budget disabled', async () => {
    wireNpmFailure(OFFLINE_STDERR);

    const { code } = await planJson();
    expect(code).toBe(0);

    const views = npmCalls.filter((a) => a[0] === 'view');
    // One attempt. A DNS failure is deterministic within a run, so a second
    // attempt is pure latency.
    expect(views, `npm calls: ${JSON.stringify(npmCalls)}`).toHaveLength(1);
    // ...and that single attempt turns off the npm CLI's own error-blind
    // retry ladder (fetch-retries=2 → 10s + 60s), which is where the
    // reported 70s went. piot owns the retry decision; npm must not add
    // a budget of its own underneath it.
    expect(views[0]).toContain('--fetch-retries=0');
  });

  it('renders UNKNOWN — not PUBLISH — and still emits the matrix when npm is unreachable', async () => {
    wireNpmFailure(OFFLINE_STDERR);

    const { code, out } = await planJson();

    const verdict = out.verdicts.find((v) => v.package === 'demo-npm');
    // "We could not reach npm" is not "the version is absent". Reporting
    // PUBLISH here is a release surprise: the preview asserts a publish
    // will happen on evidence it never obtained.
    expect(verdict, `plan output: ${stdoutChunks.join('')}`).toMatchObject({
      version: '1.2.3',
      verdict: 'unknown',
    });
    // The read-only diagnostic degrades, never aborts.
    expect(out.matrix.map((r) => r.name)).toContain('demo-npm');
    expect(code).toBe(0);
  });

  it('still renders PUBLISH when npm answers and the version is genuinely absent', async () => {
    wireNpmFailure(ABSENT_STDERR);

    const { code, out } = await planJson();

    const verdict = out.verdicts.find((v) => v.package === 'demo-npm');
    // The boundary: a reachable registry that says "no such version" is the
    // real PUBLISH answer and must not get swept into `unknown`.
    expect(verdict, `plan output: ${stdoutChunks.join('')}`).toMatchObject({
      version: '1.2.3',
      verdict: 'publish',
    });
    expect(code).toBe(0);
  });
});
