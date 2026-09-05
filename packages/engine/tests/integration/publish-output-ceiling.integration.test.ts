/**
 * A publish must not be killed by its own subprocess output, and what it
 * keeps of that output must be bounded and legible (#664).
 *
 * `execCapture` hands `maxBuffer` straight to `node:child_process
 * .execFile`, whose overflow policy is not truncation: Node raises
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and SIGTERMs the child. A `cargo
 * publish --verbose` that was going to succeed dies partway through and
 * the engine reports a failure cargo never produced — on a possibly
 * half-completed registry upload, which is the partial-publish state the
 * all-or-nothing commitment exists to prevent.
 *
 * Today no call site passes `maxBuffer`, and passing `undefined`
 * *disables* Node's default rather than inheriting it (`execFile` spreads
 * the caller's options over its own, and `len > undefined` is never
 * true). So the engine's capture is currently unbounded — safe from the
 * kill by accident, and unbounded in memory as a consequence. Both halves
 * are one refactor from flipping.
 *
 * Real config loader, real plan, real preflight, real handler dispatch,
 * and — unlike its siblings — the **real process seam**: `cargo` is a stub
 * script on `PATH`, not a mocked `execFile`, because the bug lives in
 * `execFile`'s own buffering. Only crates.io HTTP is mocked (msw).
 *
 * The e2e twin is `tests/e2e/publish-output-ceiling.e2e.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { publish } from '../../src/publish.js';
import { makeServer, makeState, type RegistryState } from './mock-registries.js';

let state: RegistryState;
const server = (() => {
  state = makeState();
  return makeServer(state);
})();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/**
 * The shape of a real verbose build: a cold `cargo publish --verbose` of a
 * mid-sized crate was measured at ~380KB of stderr (#651). Comfortably
 * inside anything the seam should keep whole.
 */
const ORDINARY_BYTES = 3 * 1024 * 1024;
/** Past any ceiling the seam can reasonably carry — the elision path. */
const RUNAWAY_BYTES = 10 * 1024 * 1024;
const HEAD_MARKER = 'PIOT-664-HEAD-first-line-of-cargo-chatter';
const TAIL_MARKER = 'PIOT-664-TAIL-where-cargo-prints-the-error';

let repo: string;
let stubDir: string;
let originalPath: string | undefined;

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/**
 * Install a `cargo` stub on `PATH` that writes `bytes` of chatter to
 * stderr, bracketed by markers, and exits with `exitCode`. Deliberately a
 * real executable rather than a mocked `execFile`: the failure under test
 * is Node's buffering of a real pipe.
 *
 * `writeSync` rather than `process.stderr.write`: writes to a pipe are
 * async, so a chatty child that exits promptly can lose its own tail and
 * the assertions would pass for the wrong reason.
 */
function installCargoStub(bytes: number, exitCode: number): void {
  const script = [
    'const { writeSync } = require("node:fs");',
    'const line = "cargo-verbose-chatter ".padEnd(255, "-") + "\\n";',
    `writeSync(2, ${JSON.stringify(HEAD_MARKER + '\n')});`,
    `for (let n = 0; n < ${bytes}; n += line.length) { writeSync(2, line); }`,
    `writeSync(2, ${JSON.stringify(TAIL_MARKER + '\n')});`,
    `process.exitCode = ${exitCode};`,
  ].join('\n');
  const stub = join(stubDir, 'cargo');
  writeFileSync(stub, `#!${process.execPath}\n${script}\n`, 'utf8');
  chmodSync(stub, 0o755);
}

/** Drive `publish` to completion and hand back whatever it threw, if anything. */
async function publishError(): Promise<string> {
  try {
    await publish({ cwd: repo });
  } catch (err) {
    return (err as Error).message;
  }
  return '';
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

  repo = mkdtempSync(join(tmpdir(), 'piot-output-ceiling-int-'));
  stubDir = mkdtempSync(join(tmpdir(), 'piot-output-ceiling-bin-'));

  originalPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${originalPath ?? ''}`;

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

  process.env.CARGO_REGISTRY_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  delete process.env.CARGO_REGISTRY_TOKEN;
  server.resetHandlers();
});

describe('publish against a subprocess that outruns the capture ceiling (#664)', () => {
  it('bounds a runaway stream instead of killing the publish', async () => {
    // 10 MiB of chatter and a clean cargo exit. The engine must keep the
    // stream inside its own ceiling and still report the publish that
    // cargo actually completed.
    installCargoStub(RUNAWAY_BYTES, 0);

    const result = await publish({ cwd: repo });

    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['lib-rs']);
  });

  it('says how much it dropped rather than letting the stream just stop', async () => {
    // The legibility half. A truncated stream that ends without warning
    // reads like a tool that fell silent; the byte count is what tells a
    // reader the engine bounded it on purpose. The banner leads the
    // captured stream rather than sitting at the cut, so it survives a
    // downstream head-and-tail render of the same text (#651/#658).
    installCargoStub(RUNAWAY_BYTES, 101);

    expect(await publishError()).toMatch(
      /\[putitoutthere\] capture ceiling reached: dropped \d+ bytes/,
    );
  });

  it('keeps cargo\'s last words when it bounds the stream', async () => {
    // Diagnosis lives at the end of a build log — the error and its
    // `Caused by:` frames. Whatever the seam drops, it cannot be the tail.
    installCargoStub(RUNAWAY_BYTES, 101);

    const message = await publishError();
    expect(message).toContain(TAIL_MARKER);
    expect(message).not.toContain('maxBuffer length exceeded');
  });

  it('keeps the head too, so the failing phase is still named', async () => {
    installCargoStub(RUNAWAY_BYTES, 101);

    expect(await publishError()).toContain(HEAD_MARKER);
  });

  it('leaves an ordinary verbose build unbounded and unmarked', async () => {
    // Guard rail against over-correcting: the ceiling must sit far enough
    // above a real verbose build that the elision path stays theoretical.
    installCargoStub(ORDINARY_BYTES, 101);

    const message = await publishError();
    expect(message).toContain(TAIL_MARKER);
    expect(message).not.toMatch(/capture ceiling reached/);
  });
});
