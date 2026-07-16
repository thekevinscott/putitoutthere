/**
 * `runChecks` crate-size pre-merge check — integration test.
 *
 * Issue #362. A tracked symlink (or a missing `[package].exclude`) can
 * drag a crate's build tree into the `.crate` that `cargo package`
 * produces. crates.io rejects any upload over 10 MiB with `413 Payload
 * Too Large` — but only mid-release, inside `cargo publish`, after the
 * verification build. This check runs `cargo package` at PR time and
 * fails before merge instead, so the regression is caught on the PR
 * that introduces it rather than on a release run weeks later.
 *
 * Real config loader, real git walk, real check dispatch. Mocked seam:
 * the `cargo package` subprocess (`spawnSync`). The integration CI job
 * has no Rust toolchain, and the size signal is cargo's own reported
 * compressed figure — so faking the subprocess at the boundary is both
 * necessary and sufficient. `git` (used by `runChecks` to walk tracked
 * files) stays real.
 */

import type * as ExecCaptureModule from '../../src/utils/exec-capture.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// git stays real (`runChecks` walks `git ls-files` through the seam); only
// the `cargo package` call this check shells out to is faked. The seam is
// partially mocked so the git ls-files path keeps the real implementation.
vi.mock('../../src/utils/exec-capture.js', async (orig) => {
  const actual = await orig<typeof ExecCaptureModule>();
  return {
    ...actual,
    execCapture: vi.fn((cmd: string, args: readonly string[], opts?: unknown) => {
      if (cmd === 'cargo') {return cargoImpl();}
      return actual.execCapture(cmd, args, opts as never);
    }),
  };
});

import { runChecks } from '../../src/check.js';
import type { ExecResult } from '../../src/utils/exec-capture.js';
import { ExecError } from '../../src/utils/exec-error.js';

/** The faked `cargo package` outcome for the current test. */
let cargoImpl: () => Promise<ExecResult>;

/** A cargo-package run that succeeded and reported `compressed` size. */
function cargoPackaged(compressed: string): () => Promise<ExecResult> {
  const stderr = [
    '   Packaging rust-lib v0.1.0 (/tmp/repo/packages/rs)',
    '   Archiving Cargo.toml',
    '   Archiving src/lib.rs',
    `    Packaged 7 files, 24.0KiB (${compressed} compressed)`,
    '',
  ].join('\n');
  return () => Promise.resolve({ stdout: '', stderr });
}

let repo: string;

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function commitAll(): void {
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'snapshot']);
}

/** A well-formed single crates-package repo, committed and ready. */
function seedCratesRepo(): void {
  writeRepoFile(
    'putitoutthere.toml',
    `
[putitoutthere]
version = 1

[[package]]
name  = "rust-lib"
kind  = "crates"
path  = "packages/rs"
globs = ["packages/rs/**"]
`,
  );
  writeRepoFile(
    'packages/rs/Cargo.toml',
    `
[package]
name = "rust-lib"
version = "0.1.0"
description = "a crate"
license = "MIT"
`,
  );
  writeRepoFile('packages/rs/src/lib.rs', '');
  commitAll();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-crate-size-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  // Benign default: a tiny crate. Tests that care override it.
  cargoImpl = cargoPackaged('8.9KiB');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('runChecks: crate-size pre-merge check (#362)', () => {
  it("flags a crates package whose packaged .crate exceeds crates.io's 10 MiB limit", async () => {
    seedCratesRepo();
    // cargo packaged a 133.6 MiB `.crate` — the dirsql incident shape.
    cargoImpl = cargoPackaged('133.6MiB');
    const findings = await runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) =>
          f.package === 'rust-lib' &&
          /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message) &&
          /10 MiB|10485760|limit/i.test(f.message),
      ),
    ).toBe(true);
  });

  it('does not flag a crates package whose packaged .crate is within the limit', async () => {
    // Pins the other half of the contract: an always-fires regression
    // would also satisfy the red test above. cargo reports a small
    // `.crate`, so the size check must stay silent.
    seedCratesRepo();
    cargoImpl = cargoPackaged('2.1MiB');
    const findings = await runChecks({ cwd: repo });
    expect(findings.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message))).toBe(
      false,
    );
  });

  it('does not flag when cargo cannot be run (no Rust toolchain)', async () => {
    // The check degrades to "can't verify" rather than false-positive
    // when `cargo` is absent — the same null-means-skip shape the
    // tracked-files walk uses when there is no git repo.
    seedCratesRepo();
    cargoImpl = () => Promise.reject(new ExecError('spawn cargo ENOENT', '', '', null));
    const findings = await runChecks({ cwd: repo });
    expect(findings.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message))).toBe(
      false,
    );
  });

  it('does not flag when cargo package exits non-zero', async () => {
    // A manifest cargo itself rejects is a different failure mode that
    // other checks / the publish path own; the size check must not
    // invent a size finding from a failed run.
    seedCratesRepo();
    cargoImpl = () =>
      Promise.reject(new ExecError('cargo failed', '', 'error: failed to parse manifest\n', 101));
    const findings = await runChecks({ cwd: repo });
    expect(findings.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message))).toBe(
      false,
    );
  });
});
