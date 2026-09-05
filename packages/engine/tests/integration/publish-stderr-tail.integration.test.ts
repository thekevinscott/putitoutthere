/**
 * A failed publish keeps the tail of the tool's stderr — the part that
 * carries the error — inside GitHub's per-line log budget.
 *
 * #651. `cargo publish --verbose` under `CARGO_TERM_VERBOSE=true` emits
 * hundreds of KB of healthy build chatter before it says what went wrong.
 * The crates handler renders that whole stream into the message it throws,
 * and the engine logs that message as a single structured record. GitHub
 * Actions cuts a log line at 64KB — in the live view and in the downloaded
 * archive alike — and what survives is the *head*: index update, packaging,
 * the first seconds of `Compiling`. The tail, where cargo prints the actual
 * error, is what gets discarded. On testing-conventions Release run
 * 32420886012 the only diagnostic a consumer got was 64KB of successful
 * build output that stops mid-compile.
 *
 * The contract pinned here: when a tool's stderr is too large to survive
 * the line cut, the record the engine logs keeps the head *and* the tail,
 * announces the elided middle with a byte count, and stays under the
 * budget — while the job-summary dump, which is a file and not a log line,
 * still holds the stream whole.
 *
 * Same harness as `publish-crates.integration.test.ts`: a real git repo,
 * real config load / plan / preflight / handler dispatch, with only the
 * cargo subprocess and the crates.io HTTP boundary stubbed. The e2e twin
 * (`tests/e2e/publish-stderr-tail.e2e.test.ts`) drives the same scenario
 * through the built CLI over a real pipe.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { publish } from '../../src/publish.js';
import { makeServer, makeState, type RegistryState } from './mock-registries.js';

// Dual-mock window, as in publish-crates.integration.test.ts: intercept
// `cargo` at the Node built-in under the process seam and delegate
// everything else (`git`) to the real binary.
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

/** GitHub Actions' per-line log cut. Every byte past this one is dropped. */
const GHA_LOG_LINE_LIMIT = 64 * 1024;

const HEAD_MARKER = 'PIOT-651-HEAD-4c1a';
const TAIL_MARKER = 'PIOT-651-TAIL-9f3e';

/**
 * A stand-in for a cold `cargo publish --verbose` verify build that fails:
 * a first line naming the phase, ~380KB of healthy `Compiling` chatter (the
 * size measured on the crate in #651), then cargo's error last. Both ends
 * are marked so a test can say which of them survived.
 */
const CARGO_STDERR = (() => {
  const noise =
    '   Compiling some-transitive-dep v1.2.3 ' +
    '(registry `crates-io`) --edition=2021 -C opt-level=3 --cap-lints allow';
  const first = `       Updating crates.io index ${HEAD_MARKER}`;
  const lines = [first];
  let size = first.length;
  for (let i = 0; size < 380 * 1024; i += 1) {
    const line = `${noise} #${i}`;
    lines.push(line);
    size += line.length + 1;
  }
  lines.push(
    'error: failed to verify package tarball',
    '',
    'Caused by:',
    `  could not compile \`lib-rs\` (lib) due to 1 previous error ${TAIL_MARKER}`,
  );
  return lines.join('\n');
})();

const CARGO_EXIT_CODE = 101;

let state: RegistryState;
const server = (() => {
  state = makeState();
  return makeServer(state);
})();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

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
name  = "lib-rs"
kind  = "crates"
path  = "packages/rust"
globs = ["packages/rust/**"]
`;

const CARGO_TOML = `[package]
name = "lib-rs"
version = "0.0.0"
edition = "2021"
description = "A test crate."
license = "MIT"
`;

beforeEach(() => {
  state.crates.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;

  repo = mkdtempSync(join(tmpdir(), 'piot-stderr-tail-int-'));
  summaryPath = join(repo, 'step-summary.md');
  writeFileSync(summaryPath, '', 'utf8');

  execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (cmd === 'cargo') {
      cb(
        Object.assign(new Error('Command failed'), { code: CARGO_EXIT_CODE }),
        '',
        CARGO_STDERR,
      );
      return fakeChild(CARGO_EXIT_CODE);
    }
    return (realExecFile as unknown as (...a: unknown[]) => ChildProcess.ChildProcess)(
      cmd,
      args,
      opts,
      cb,
    );
  }) as unknown as typeof execFile);

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('packages/rust/src/lib.rs', '');
  writeRepoFile('packages/rust/Cargo.toml', CARGO_TOML);
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  process.env.CARGO_REGISTRY_TOKEN = 'cargo-token-for-preflight';
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  delete process.env.GITHUB_STEP_SUMMARY;
  execMock.mockReset();
  server.resetHandlers();
});

interface FailedPublish {
  /** The message `publish()` rejected with. */
  message: string;
  /** Every line the engine wrote to stderr, as GitHub would see them. */
  logLines: string[];
}

/**
 * Run publish(), expect it to fail, and hand back both the rejection and
 * the log stream. stderr is captured rather than passed through: the whole
 * subject of this test is a stream too big to want in the runner's output.
 */
async function failedPublish(): Promise<FailedPublish> {
  const chunks: string[] = [];
  const write = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
  try {
    await publish({ cwd: repo });
  } catch (err) {
    return {
      message: (err as Error).message,
      logLines: chunks.join('').split('\n'),
    };
  } finally {
    write.mockRestore();
  }
  throw new Error('expected publish to reject');
}

describe('an oversized publish stderr keeps its tail in the log (#651)', () => {
  it("logs cargo's last words, where the error is", async () => {
    // The whole point of #651: on the run that motivated it the tail was
    // the one thing missing, so the failure was undiagnosable.
    const { logLines } = await failedPublish();
    expect(logLines.some((l) => l.includes(TAIL_MARKER))).toBe(true);
  });

  it('writes no line longer than the 64KB GitHub cuts at', async () => {
    // The engine logs the rendered failure as one structured record. A
    // record longer than the cut cannot survive it whole, and the half
    // GitHub keeps is the head — so bounding the message *is* the fix.
    const { logLines } = await failedPublish();
    const longest = Math.max(...logLines.map((l) => l.length));
    expect(longest).toBeLessThanOrEqual(GHA_LOG_LINE_LIMIT);
  });

  it('keeps the head too, so the failing phase is still named', async () => {
    // Bounding by "keep the last 16KB" alone would drop which cargo phase
    // was running. Head and tail both survive; only the middle goes.
    // Asserted as a boolean, not `toContain`: while the bug is live the
    // received value is the whole ~380KB message, and a failing matcher
    // prints it — reproducing #651 inside the test report.
    const { message } = await failedPublish();
    expect(message.includes(HEAD_MARKER)).toBe(true);
  });

  it('says how many bytes it dropped rather than ending mid-stream', async () => {
    // A silent cut reads as "cargo stopped here". Announce the elision,
    // with a count, so the reader knows the stream continued.
    const { message } = await failedPublish();
    expect(/\[\.\.\. \d+ bytes elided \.\.\.\]/.test(message)).toBe(true);
  });

  it('leaves the job-summary dump holding the whole stream', async () => {
    // The summary is a file, not a log line — nothing there is cut at
    // 64KB, so bounding the log record must not cost the full evidence.
    await failedPublish();
    const summary = readFileSync(summaryPath, 'utf8');
    expect(summary).toContain(HEAD_MARKER);
    expect(summary).toContain(TAIL_MARKER);
    expect(summary.length).toBeGreaterThan(GHA_LOG_LINE_LIMIT);
  });
});
