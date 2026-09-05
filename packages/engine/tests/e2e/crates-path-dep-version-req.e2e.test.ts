/**
 * A crates release rewrites the in-repo requirements pointing at it — e2e.
 *
 * Issue #640. The e2e twin of
 * `tests/integration/crates-path-dep-version-req.integration.test.ts`: same
 * scenario, two fidelities. Where the integration test drives `publish()`
 * in-process with `cargo` mocked and inspects manifest text, this one
 * **shells out to the built CLI** (`node dist/cli-bin.js publish`) and then
 * makes **real cargo actually resolve the workspace**.
 *
 * That is the whole point of this tier here. The bug is not a wrong string
 * in a file — it is a tree cargo refuses to build. Every manifest assertion
 * can read green on a workspace that cannot resolve at all, so the only
 * check that cannot be self-consistently wrong is handing the result to
 * cargo and asking.
 *
 * `cargo metadata --offline` (with resolution, i.e. *without* `--no-deps`)
 * reproduces the issue's failure verbatim:
 *
 *     error: failed to select a version for the requirement `…-core = "^0.2"`
 *     candidate versions found which didn't match: 0.4.2
 *     location searched: …/packages/core
 *
 * `location searched` naming the local path — not an index — also settles the
 * caveat the issue flagged: for a `path` + `version` dependency cargo checks
 * the requirement against the path crate's on-disk manifest, so registry
 * state cannot change the outcome. The repro holds online for the same
 * reason it holds offline.
 *
 * **No registry is contacted by the publish attempt.** `CARGO_NET_OFFLINE`
 * makes the real `cargo publish` fail immediately, before it can reach any
 * index, so this test can drive the genuine publish path — the only route to
 * the crates handler's `writeVersion` — without ever publishing anything.
 * The engine has already written the manifests by then, and those writes are
 * the subject. The one real network call is `isPublished` GETting crates.io
 * for crate names that have never existed (404s), which is the read-mostly
 * shape this tier is for.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

// Crate names that have never been published, so `isPublished` gets clean
// 404s and the publish path proceeds to `writeVersion`.
const CORE = 'piot-fixture-zzz-nonexistent-640-core';
const HOST = 'piot-fixture-zzz-nonexistent-640-host';
// The release lands outside the `0.2` requirement the host declares — the
// bump that takes the dependency out of range is what breaks resolution.
const RELEASE = '0.4.2';

let repo: string;

function write(rel: string, body: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

/**
 * Shell out to the real CLI. `CARGO_NET_OFFLINE` keeps the real
 * `cargo publish` from reaching any registry; the GitHub vars are dropped so
 * the repo-visibility pre-flight no-ops, and a throwaway token clears the
 * auth pre-flight (never used — cargo never gets far enough to send it).
 */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = {
    ...process.env,
    CARGO_REGISTRY_TOKEN: 'not-a-token',
    CARGO_NET_OFFLINE: 'true',
  };
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

/**
 * Make real cargo resolve the workspace. Returns cargo's own verdict rather
 * than throwing, so a test can assert on the resolution error text as well
 * as on success.
 */
function cargoResolve(): { code: number; stderr: string } {
  try {
    execFileSync('cargo', ['metadata', '--offline', '--format-version', '1'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    return { code: e.status ?? 1, stderr: e.stderr?.toString() ?? '' };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-crates-path-dep-e2e-'));

  write(
    'putitoutthere.toml',
    `[putitoutthere]\nversion = 1\n\n` +
      `[[package]]\nname  = "${CORE}"\nkind  = "crates"\npath  = "packages/core"\n` +
      `globs = ["packages/core/**"]\nfirst_version = "${RELEASE}"\n\n` +
      `[[package]]\nname  = "${HOST}"\nkind  = "crates"\npath  = "packages/host"\n` +
      `globs = ["packages/host/**"]\ndepends_on = ["${CORE}"]\nfirst_version = "${RELEASE}"\n`,
  );
  write(
    'Cargo.toml',
    '[workspace]\nmembers = ["packages/core", "packages/host"]\nresolver = "2"\n',
  );
  write(
    'packages/core/Cargo.toml',
    `[package]\nname = "${CORE}"\nversion = "0.2.0"\nedition = "2021"\n` +
      'description = "Put It Out There canary fixture. Safe to ignore."\nlicense = "MIT"\n',
  );
  // The `version` key alongside `path` is mandatory for any crate that also
  // publishes to crates.io — so this is not an exotic shape, it is the
  // required one.
  write(
    'packages/host/Cargo.toml',
    `[package]\nname = "${HOST}"\nversion = "0.2.0"\nedition = "2021"\n` +
      'description = "Put It Out There canary fixture. Safe to ignore."\nlicense = "MIT"\n\n' +
      `[dependencies]\n${CORE} = { path = "../core", version = "0.2" }\n`,
  );
  write('packages/core/src/lib.rs', '');
  write('packages/host/src/lib.rs', '');

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-m', 'feat: initial\n\nrelease: patch']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('crates publish rewrites in-repo path-dep requirements (#640)', () => {
  it('leaves a workspace real cargo can still resolve', () => {
    // The tree resolves before the release: `0.2.0` satisfies `^0.2`.
    expect(cargoResolve().code).toBe(0);

    runCli(['publish']);

    // Bumping the core past the host's requirement without moving the
    // requirement is a hard failure (exit 101) before anything compiles.
    const after = cargoResolve();
    expect(after.stderr).toBe('');
    expect(after.code).toBe(0);
  });

  it('does not leave the requirement stranded below the released version', () => {
    runCli(['publish']);

    // Named explicitly so a regression reads as the bug rather than as a
    // generic cargo failure.
    expect(cargoResolve().stderr).not.toContain('failed to select a version for the requirement');
  });

  it('fails the publish without contacting a registry', () => {
    // Expected and asserted: `cargo publish` cannot reach an index under
    // CARGO_NET_OFFLINE, so the run fails *after* the manifests are written.
    // Nothing is ever uploaded.
    expect(runCli(['publish']).code).not.toBe(0);
  });
});
