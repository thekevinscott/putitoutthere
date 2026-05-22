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

import type * as ChildProcess from 'node:child_process';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  // git stays real (`runChecks` walks `git ls-files`); only the cargo
  // subprocess this check shells out to is faked.
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

import { runChecks } from '../../src/check.js';

const spawnMock = vi.mocked(spawnSync);

/** A cargo-package run that succeeded and reported `compressed` size. */
function cargoPackaged(compressed: string): ReturnType<typeof spawnSync> {
  const stderr = [
    '   Packaging rust-lib v0.1.0 (/tmp/repo/packages/rs)',
    '   Archiving Cargo.toml',
    '   Archiving src/lib.rs',
    `    Packaged 7 files, 24.0KiB (${compressed} compressed)`,
    '',
  ].join('\n');
  return {
    pid: 1234,
    output: ['', stderr],
    stdout: '',
    stderr,
    status: 0,
    signal: null,
  } as unknown as ReturnType<typeof spawnSync>;
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
  spawnMock.mockReturnValue(cargoPackaged('8.9KiB'));
});

afterEach(() => {
  spawnMock.mockReset();
  rmSync(repo, { recursive: true, force: true });
});

describe('runChecks: crate-size pre-merge check (#362)', () => {
  it("flags a crates package whose packaged .crate exceeds crates.io's 10 MiB limit", () => {
    seedCratesRepo();
    // cargo packaged a 133.6 MiB `.crate` — the dirsql incident shape.
    spawnMock.mockReturnValue(cargoPackaged('133.6MiB'));
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) =>
          f.package === 'rust-lib' &&
          /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message) &&
          /10 MiB|10485760|limit/i.test(f.message),
      ),
    ).toBe(true);
  });

  it('does not flag a crates package whose packaged .crate is within the limit', () => {
    // Pins the other half of the contract: an always-fires regression
    // would also satisfy the red test above. cargo reports a small
    // `.crate`, so the size check must stay silent.
    seedCratesRepo();
    spawnMock.mockReturnValue(cargoPackaged('2.1MiB'));
    const findings = runChecks({ cwd: repo });
    expect(findings.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message))).toBe(
      false,
    );
  });

  it('does not flag when cargo cannot be run (no Rust toolchain)', () => {
    // The check degrades to "can't verify" rather than false-positive
    // when `cargo` is absent — the same null-means-skip shape the
    // tracked-files walk uses when there is no git repo.
    seedCratesRepo();
    spawnMock.mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: Object.assign(new Error('spawnSync cargo ENOENT'), {
        code: 'ENOENT',
      }),
    } as unknown as ReturnType<typeof spawnSync>);
    const findings = runChecks({ cwd: repo });
    expect(findings.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message))).toBe(
      false,
    );
  });

  it('does not flag when cargo package exits non-zero', () => {
    // A manifest cargo itself rejects is a different failure mode that
    // other checks / the publish path own; the size check must not
    // invent a size finding from a failed run.
    seedCratesRepo();
    spawnMock.mockReturnValue({
      pid: 1,
      output: ['', 'error: failed to parse manifest\n'],
      stdout: '',
      stderr: 'error: failed to parse manifest\n',
      status: 101,
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);
    const findings = runChecks({ cwd: repo });
    expect(findings.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message))).toBe(
      false,
    );
  });
});
