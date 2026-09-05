/**
 * The e2e twin of `tests/integration/publish-stderr-tail.integration.test.ts`
 * (#651): a failed publish's log must carry the tail of the tool's stderr,
 * where the error is, inside GitHub's 64KB per-line cut.
 *
 * Where the integration test drives the engine in-process with the
 * subprocess mocked, this one **shells out to the built CLI**
 * (`node dist/cli-bin.js publish …`) and reads the bytes the process
 * actually wrote. Everything between the failing child and the log line is
 * real: a real pipe carrying ~380KB of stderr, the real `execCapture` seam
 * (whose `maxBuffer` a stream this size is measured against), the real
 * logger, the real CLI error path. The idempotency probe is a real
 * crates.io GET for a crate that has never been published — a live 404, so
 * the publish path is genuinely entered.
 *
 * Only `cargo` is stubbed, as a recording script on `PATH` — same device as
 * the `gh` stub in `release-github.e2e.test.ts`, and for the same reason: a
 * cold verify build that fails on demand is not something a test loop can
 * produce hermetically. The stub is a real subprocess writing real bytes;
 * what it is standing in for is only *which* tool produced them.
 *
 * Red before the fix: the engine renders the whole stream into the message
 * it throws and logs that as one structured record, so the longest line the
 * CLI writes is the size of cargo's stderr — six times past the cut, with
 * cargo's error in the discarded half.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

/** GitHub Actions' per-line log cut. Every byte past this one is dropped. */
const GHA_LOG_LINE_LIMIT = 64 * 1024;

const HEAD_MARKER = 'PIOT-651-HEAD-4c1a';
const TAIL_MARKER = 'PIOT-651-TAIL-9f3e';

/** Never published, so the real crates.io GET is a real 404. */
const CRATE = 'piot-fixture-zzz-nonexistent-651';

/**
 * A `cargo` that reproduces #651's stderr profile: ~380KB of healthy
 * verbose build chatter (the size measured on the crate in the issue) and
 * then, last, the error. Written with `process.exitCode` rather than
 * `process.exit` so Node flushes the whole stream down the pipe first.
 */
const CARGO_STUB = `#!/usr/bin/env node
if (process.argv[2] !== 'publish') { process.exit(0); }
const noise =
  '   Compiling some-transitive-dep v1.2.3 ' +
  '(registry \`crates-io\`) --edition=2021 -C opt-level=3 --cap-lints allow';
const first = '       Updating crates.io index ${HEAD_MARKER}';
const lines = [first];
let size = first.length;
for (let i = 0; size < 380 * 1024; i += 1) {
  const line = noise + ' #' + i;
  lines.push(line);
  size += line.length + 1;
}
lines.push(
  'error: failed to verify package tarball',
  '',
  'Caused by:',
  '  could not compile \`lib-rs\` (lib) due to 1 previous error ${TAIL_MARKER}',
);
process.exitCode = 101;
process.stderr.write(lines.join('\\n'));
`;

let repo: string;
let bin: string;
let summaryPath: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

interface CliRun {
  code: number;
  stderr: string;
}

/**
 * Shell out to the built CLI with the cargo stub ahead on `PATH`.
 *
 * `maxBuffer` is lifted well past Node's 1 MiB default on purpose: the
 * whole subject of this test is a child that writes far more than a
 * default-sized buffer holds, and the harness must not be the thing that
 * truncates it.
 */
function runCli(args: string[]): CliRun {
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    CARGO_REGISTRY_TOKEN: 'cargo-token-for-preflight',
    GITHUB_STEP_SUMMARY: summaryPath,
    // Aim the repo-shaped preflights at nothing: this temp tree is not the
    // repo the ambient CI env describes, and a visibility probe against
    // GitHub is not what is under test here.
    GITHUB_REPOSITORY: '',
    GITHUB_OUTPUT: join(repo, 'gha-output.txt'),
  };
  try {
    execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? '' };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-stderr-tail-e2e-'));
  bin = mkdtempSync(join(tmpdir(), 'piot-stderr-tail-bin-'));
  summaryPath = join(repo, 'step-summary.md');
  writeFileSync(summaryPath, '', 'utf8');

  const cargo = join(bin, 'cargo');
  writeFileSync(cargo, CARGO_STUB, 'utf8');
  chmodSync(cargo, 0o755);

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  writeRepoFile(
    'putitoutthere.toml',
    `[putitoutthere]
version = 1

[[package]]
name  = "lib-rs"
kind  = "crates"
crate = "${CRATE}"
path  = "packages/rust"
globs = ["packages/rust/**"]
`,
  );
  writeRepoFile('packages/rust/src/lib.rs', '');
  writeRepoFile(
    'packages/rust/Cargo.toml',
    `[package]
name = "${CRATE}"
version = "0.0.0"
edition = "2021"
description = "A test crate."
license = "MIT"
`,
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial\n\nrelease: patch']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

describe('a real oversized cargo stderr survives to the log (#651)', () => {
  it("writes cargo's last words, where the error is", async () => {
    const { code, stderr } = runCli(['publish', '--json', '--cwd', repo]);
    expect({ code, tail: stderr.includes(TAIL_MARKER) }).toEqual({
      code: 1,
      tail: true,
    });
  });

  it('writes no line longer than the 64KB GitHub cuts at', async () => {
    const { stderr } = runCli(['publish', '--json', '--cwd', repo]);
    const longest = Math.max(...stderr.split('\n').map((l) => l.length));
    expect(longest).toBeLessThanOrEqual(GHA_LOG_LINE_LIMIT);
  });

  it('keeps the head and announces the bytes it dropped', async () => {
    const { stderr } = runCli(['publish', '--json', '--cwd', repo]);
    expect({
      head: stderr.includes(HEAD_MARKER),
      elided: /\[\.\.\. \d+ bytes elided \.\.\.\]/.test(stderr),
    }).toEqual({ head: true, elided: true });
  });
});
