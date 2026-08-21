/**
 * The crates publish path bumps the crate's OWN version — e2e.
 *
 * Issue #639. The e2e twin of
 * `tests/integration/crates-write-version.integration.test.ts`: same
 * scenario, two fidelities. Where the integration test drives `publish()`
 * in-process with `cargo` mocked and inspects manifest text, this one
 * **shells out to the built CLI** (`node dist/cli-bin.js publish`) and then
 * asks **real cargo** what it makes of the tree the engine left behind.
 *
 * That last step is why this tier is not optional here. The whole bug is a
 * regex reaching past the table it was aimed at, and a manifest-text
 * assertion is written by the same person who was wrong about where the
 * table ended. `cargo metadata` is the authority on what
 * `version.workspace = true` resolves to and on what requirement a
 * dependency actually carries — it is the reader whose disagreement is the
 * failure.
 *
 * **No registry is contacted by the publish attempt.** `CARGO_NET_OFFLINE`
 * makes the real `cargo publish` fail immediately, before it can reach any
 * index, so this test can drive the genuine publish path — the only route to
 * the crates handler's `writeVersion` — without ever publishing anything.
 * The non-zero exit is expected and asserted; the engine has already written
 * the manifests by the time cargo refuses, and those writes are the subject.
 * The one real network call is the handler's `isPublished` GET against
 * crates.io for a crate name that has never existed (a 404), which is the
 * read-mostly shape this tier is for.
 *
 * `cargo metadata --no-deps` resolves workspace inheritance without touching
 * the dependency graph, so the assertions stay offline and fast even though
 * the fixture declares a registry dependency.
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

// A crate name that has never been published, so `isPublished` gets a clean
// 404 and the publish path proceeds to `writeVersion`.
const CRATE = 'piot-fixture-zzz-nonexistent-639';

interface CargoPackage {
  name: string;
  version: string;
  dependencies: Array<{ name: string; req: string }>;
}

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
 * auth pre-flight (it is never used — cargo never gets far enough to send
 * it).
 */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = {
    ...process.env,
    CARGO_REGISTRY_TOKEN: 'piot-e2e-639-placeholder',
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

/** Real cargo's view of the workspace member: the authority, not our regex. */
function cargoPackage(): CargoPackage {
  const raw = execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--offline', '--format-version', '1'],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const { packages } = JSON.parse(raw) as { packages: CargoPackage[] };
  const pkg = packages.find((p) => p.name === CRATE);
  if (pkg === undefined) {throw new Error(`cargo metadata did not report ${CRATE}`);}
  return pkg;
}

/** The version the engine itself planned, read back from the real CLI. */
function plannedVersion(): string {
  const { stdout } = runCli(['plan', '--json']);
  const { matrix } = JSON.parse(stdout) as { matrix: Array<{ version: string }> };
  const version = matrix[0]?.version;
  if (version === undefined) {throw new Error('plan --json produced no matrix rows');}
  return version;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-crates-write-version-e2e-'));

  write(
    'putitoutthere.toml',
    `[putitoutthere]\nversion = 1\n\n[[package]]\nname  = "${CRATE}"\nkind  = "crates"\npath  = "packages/rust"\nglobs = ["packages/rust/**"]\n`,
  );
  // The version symbol lives at the workspace root; the member inherits it.
  write(
    'Cargo.toml',
    '[workspace]\nmembers = ["packages/rust"]\nresolver = "2"\n\n[workspace.package]\nversion = "0.0.0"\n',
  );
  // No literal `[package].version`, and a section-table dependency whose
  // `version` is the first one after the `[package]` header — the exact
  // shape the lazy regex mis-targets.
  write(
    'packages/rust/Cargo.toml',
    `[package]\nname = "${CRATE}"\nversion.workspace = true\nedition = "2021"\n` +
      'description = "Put It Out There canary fixture. Safe to ignore."\nlicense = "MIT"\n\n' +
      '[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["extension-module"]\n',
  );
  write('packages/rust/src/lib.rs', '');

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

describe('crates writeVersion follows workspace inheritance (#639)', () => {
  it('leaves the dependency requirement exactly as cargo read it before', () => {
    const before = cargoPackage().dependencies.find((d) => d.name === 'pyo3')?.req;
    expect(before).toBe('^0.22');

    runCli(['publish']);

    // Cargo — not a regex of ours — reports what the requirement now says.
    // The bug rewrites it to the release version, naming a pyo3 that was
    // never published; cargo would then either refuse to resolve or silently
    // pick a release nobody chose.
    expect(cargoPackage().dependencies.find((d) => d.name === 'pyo3')?.req).toBe('^0.22');
  });

  it('bumps the version cargo resolves for the crate', () => {
    const version = plannedVersion();
    expect(version).not.toBe('0.0.0');

    runCli(['publish']);

    // Resolved through `version.workspace = true` to the workspace root, so
    // this passes only if the write landed where the version actually lives.
    expect(cargoPackage().version).toBe(version);
  });

  it('leaves a tree cargo can still read', () => {
    const { code } = runCli(['publish']);
    // Expected: `cargo publish` cannot reach a registry under
    // CARGO_NET_OFFLINE, so the run fails *after* the manifests are written.
    // Nothing is ever uploaded.
    expect(code).not.toBe(0);
    // The point is that cargo still parses the tree at all — a rewrite that
    // corrupts the manifest structurally would fail here rather than in an
    // assertion about one field.
    expect(() => cargoPackage()).not.toThrow();
  });
});
