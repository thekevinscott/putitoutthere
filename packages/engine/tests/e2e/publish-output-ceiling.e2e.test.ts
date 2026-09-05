/**
 * A publish must not be killed by its own subprocess output, and what it
 * keeps of that output must be bounded and legible (#664) — the e2e twin
 * of `tests/integration/publish-output-ceiling.integration.test.ts`.
 *
 * Where the integration test drives `publish()` in-process, this shells
 * out to the built CLI (`node dist/cli-bin.js publish`) and lets the
 * idempotency probe hit crates.io for real: `99.99.99` of piot's live
 * fixture crate is a genuine 404, so the run proceeds to the publish step.
 *
 * `cargo` is a stub on `PATH` that writes 10 MiB of chatter down a **real
 * pipe** through the **real** `execCapture` seam. Nothing is published:
 * the stub is the only thing the CLI ever executes as cargo.
 *
 * Red before the fix: `execCapture` has no ceiling of its own, so nothing
 * announces a bound and nothing enforces one.
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
const CRATE = 'piot-fixture-zzz-poly-rust';
/** Not on crates.io — a real 404, so publish proceeds to the cargo step. */
const VERSION = '99.99.99';

/** Past any ceiling the seam can reasonably carry — the elision path. */
const RUNAWAY_BYTES = 10 * 1024 * 1024;
const HEAD_MARKER = 'PIOT-664-HEAD-first-line-of-cargo-chatter';
const TAIL_MARKER = 'PIOT-664-TAIL-where-cargo-prints-the-error';

let repo: string;
let stubDir: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/**
 * A `cargo` on `PATH` that writes `bytes` of chatter to stderr, bracketed
 * by markers, and exits with `exitCode`.
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

/** Shell out to the real CLI with the cargo stub ahead of everything on PATH. */
function runCli(args: string[]): { code: number; output: string } {
  // A throwaway token clears the auth pre-flight — the stub cargo never
  // reads it. Drop the GitHub vars so the repo-visibility / URL-match
  // pre-flight no-ops.
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
    CARGO_REGISTRY_TOKEN: 'piot-e2e-output-ceiling-placeholder',
  };
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The harness must not reproduce the very bug under test: on the
      // failure case the CLI legitimately prints megabytes.
      maxBuffer: 128 * 1024 * 1024,
    });
    return { code: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      output: `${e.stdout?.toString() ?? ''}\n${e.stderr?.toString() ?? ''}`,
    };
  }
}

function publishArgs(): string[] {
  return ['publish', '--release-packages', `fixture-rust@${VERSION}`, '--cwd', repo];
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-output-ceiling-e2e-'));
  stubDir = mkdtempSync(join(tmpdir(), 'piot-output-ceiling-bin-'));
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
name  = "fixture-rust"
kind  = "crates"
crate = "${CRATE}"
path  = "packages/rust"
globs = ["packages/rust/**"]
`,
  );
  writeRepoFile(
    'packages/rust/Cargo.toml',
    `[package]
name = "${CRATE}"
version = "0.0.1"
edition = "2021"
description = "piot output-ceiling e2e fixture; never published from here"
license = "MIT"
`,
  );
  writeRepoFile('packages/rust/src/lib.rs', '');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
});

describe('publish against a 10 MiB-of-stderr cargo (#664)', () => {
  it('bounds a runaway stream instead of killing the publish', () => {
    installCargoStub(RUNAWAY_BYTES, 0);

    const { code, output } = runCli(publishArgs());

    expect(code, `publish output:\n${output.slice(0, 4096)}`).toBe(0);
  });

  it('says how much it dropped, and keeps both ends of what it kept', () => {
    installCargoStub(RUNAWAY_BYTES, 101);

    const { code, output } = runCli(publishArgs());

    expect(code).not.toBe(0);
    expect(output).toMatch(/\[putitoutthere\] capture ceiling reached: dropped \d+ bytes/);
    expect(output).toContain(HEAD_MARKER);
    expect(output).toContain(TAIL_MARKER);
    expect(output).not.toContain('maxBuffer length exceeded');
  });
});
