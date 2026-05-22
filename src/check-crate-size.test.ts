/**
 * Unit tests for `runChecks`' crate-size pre-merge check (#362).
 *
 * The behavioural contract is also exercised in
 * `test/integration/check-crate-size.integration.test.ts`. These cases
 * own coverage: the integration config is excluded from
 * `test:unit:coverage` per `vitest.config.ts`, so every branch of the
 * size check needs a unit case here — the cargo subprocess is faked at
 * the `spawnSync` boundary so the assertions are deterministic and need
 * no Rust toolchain.
 *
 * Each case stands up a throwaway git repo (cheap — `runChecks` shells
 * out to `git ls-files`) and drives `runChecks` against a hand-built
 * `putitoutthere.toml` plus the manifests the check reads.
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
  // subprocess the size check shells out to is faked.
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

import { runChecks } from './check.js';

const spawnMock = vi.mocked(spawnSync);

/** A `cargo package` run that exited 0 and reported `compressed` size. */
function cargoPackaged(compressed: string): SpawnSyncReturnsString {
  const stderr = `   Packaging rust-lib v0.1.0 (/tmp/repo)\n    Packaged 7 files, 24.0KiB (${compressed} compressed)\n`;
  return { pid: 1, output: ['', stderr], stdout: '', stderr, status: 0, signal: null };
}

/** A `cargo package` run that exited 0 with arbitrary `stderr`. */
function cargoExit0(stderr: string): SpawnSyncReturnsString {
  return { pid: 1, output: ['', stderr], stdout: '', stderr, status: 0, signal: null };
}

type SpawnSyncReturnsString = ReturnType<typeof spawnSync> & { stderr: string };

let cwd: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(rel: string, body: string): void {
  const full = join(cwd, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function commit(): void {
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'snapshot']);
}

/** Seed a committed repo with one well-formed `kind = "crates"` package. */
function seedCratesRepo(): void {
  write(
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
  write(
    'packages/rs/Cargo.toml',
    `
[package]
name = "rust-lib"
version = "0.1.0"
description = "a crate"
license = "MIT"
`,
  );
  write('packages/rs/src/lib.rs', '');
  commit();
}

function hasSizeFinding(messages: { message: string }[]): boolean {
  return messages.some((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message));
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'piot-crate-size-unit-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  git(['config', 'commit.gpgsign', 'false']);
  spawnMock.mockReturnValue(cargoPackaged('8.9KiB'));
});

afterEach(() => {
  spawnMock.mockReset();
  rmSync(cwd, { recursive: true, force: true });
});

describe('runChecks: crate-size pre-merge check (#362)', () => {
  it("flags a crates package whose .crate exceeds crates.io's 10 MiB limit", () => {
    seedCratesRepo();
    spawnMock.mockReturnValue(cargoPackaged('133.6MiB'));
    const findings = runChecks({ cwd });
    const hit = findings.find((f) => /PIOT_CRATES_PACKAGE_TOO_LARGE/.test(f.message));
    expect(hit).toBeDefined();
    expect(hit!.package).toBe('rust-lib');
    expect(hit!.message).toMatch(/133\.6 MiB/);
    expect(hit!.message).toMatch(/10\.0 MiB|10485760/);
    expect(hit!.message).toMatch(/413 Payload Too Large/);
  });

  it('does not flag a crates package whose .crate is within the limit', () => {
    seedCratesRepo();
    spawnMock.mockReturnValue(cargoPackaged('2.0MiB'));
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
  });

  it('does not flag when cargo is absent (spawnSync reports an error)', () => {
    seedCratesRepo();
    spawnMock.mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: Object.assign(new Error('spawnSync cargo ENOENT'), { code: 'ENOENT' }),
    });
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
  });

  it('does not flag when cargo package exits non-zero', () => {
    seedCratesRepo();
    spawnMock.mockReturnValue({
      pid: 1,
      output: ['', 'error: failed to parse manifest\n'],
      stdout: '',
      stderr: 'error: failed to parse manifest\n',
      status: 101,
      signal: null,
    });
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
  });

  it('does not flag when spawnSync itself throws', () => {
    seedCratesRepo();
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
  });

  it('does not flag when cargo output carries no Packaged size line', () => {
    seedCratesRepo();
    spawnMock.mockReturnValue(cargoExit0('   Compiling rust-lib v0.1.0\n'));
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
  });

  it('does not flag when cargo reports an unrecognised size unit', () => {
    seedCratesRepo();
    spawnMock.mockReturnValue(
      cargoExit0('    Packaged 7 files, 24.0KiB (5.0ZB compressed)\n'),
    );
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
  });

  it('skips non-crates packages — cargo is never invoked for them', () => {
    write(
      'putitoutthere.toml',
      `
[putitoutthere]
version = 1

[[package]]
name  = "js-lib"
kind  = "npm"
path  = "packages/js"
globs = ["packages/js/**"]
`,
    );
    write(
      'packages/js/package.json',
      JSON.stringify({
        name: 'js-lib',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
    );
    write('packages/js/index.ts', 'x');
    commit();
    expect(hasSizeFinding(runChecks({ cwd }))).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
