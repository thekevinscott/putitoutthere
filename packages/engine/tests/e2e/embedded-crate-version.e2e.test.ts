/**
 * Pre-build version bump reaches embedded workspace crates — e2e.
 *
 * Issue #621. The e2e twin of
 * `tests/integration/embedded-crate-version.integration.test.ts`: same
 * scenario, two fidelities. Where the integration test drives the engine
 * in-process and inspects manifests, this one **shells out to the built
 * CLI** (`node dist/cli-bin.js write-crate-version …`), then runs a **real
 * `cargo build`** and **executes the produced binary**, asserting on what it
 * prints.
 *
 * That last step is why this tier is not optional. The bug is about a
 * constant cargo bakes in at compile time, so the only assertion that
 * cannot be self-consistently wrong is "run it and read the output." A
 * manifest-only check is exactly the mock that lies here, in two directions:
 *
 *  - it passes while the compiled artifact still carries the stale literal
 *    (nothing proves the rewrite reached the crate cargo actually compiles);
 *  - worse, it passes on a tree that **cannot build at all**. Bumping a
 *    path dependency past a `version = "0.2"` requirement makes cargo refuse
 *    to resolve (`failed to select a version for the requirement`, exit
 *    101) before a single line compiles. Every manifest assertion still
 *    reads green.
 *
 * No registry is involved: the fixture is a self-contained two-crate cargo
 * workspace with no external dependencies, so `cargo build --offline` is
 * fast and hermetic.
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

let repo: string;

function write(rel: string, body: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
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
 * `cargo run` the host binary and hand back what it printed. Throws with
 * cargo's stderr attached so a resolution failure is legible in the report
 * rather than surfacing as an empty string.
 */
function cargoRun(): string {
  try {
    return execFileSync('cargo', ['run', '-q', '--offline', '-p', 'demo-cli'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; status?: number };
    throw new Error(
      `cargo build/run failed (exit ${e.status ?? '?'}):\n${e.stderr?.toString() ?? ''}`,
    );
  }
}

/**
 * A cargo workspace shaped like the one in the bug report: a core crate
 * owning the version-bearing symbol, embedded by path into the crate the
 * build tool actually builds. `versionReq` is the requirement the host
 * declares on the core -- the field every crates.io-publishable crate must
 * carry, and the one that turns this fix into a build failure if it is
 * left behind.
 */
function scaffold(versionReq: string | null): void {
  write('Cargo.toml', '[workspace]\nmembers = ["core", "host"]\nresolver = "2"\n');

  write('core/Cargo.toml', '[package]\nname = "demo-core"\nversion = "0.2.7"\nedition = "2021"\n');
  write(
    'core/src/lib.rs',
    // The shape clap's `#[command(version)]` expands to, in the crate where
    // the attribute is written -- NOT in whatever crate cargo happens to be
    // building.
    'pub fn version() -> &\'static str { env!("CARGO_PKG_VERSION") }\n',
  );

  const dep =
    versionReq === null
      ? 'demo-core = { path = "../core" }'
      : `demo-core = { path = "../core", version = "${versionReq}" }`;
  write(
    'host/Cargo.toml',
    `[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n[dependencies]\n${dep}\n`,
  );
  write(
    'host/src/main.rs',
    'fn main() { println!("demo {}", demo_core::version()); }\n',
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-embedded-crate-e2e-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('write-crate-version against a real cargo workspace', () => {
  it('the compiled binary reports the release version, not the on-disk literal', () => {
    scaffold(null);
    const res = runCli(['write-crate-version', '--path', join(repo, 'host'), '--version', '0.4.2']);
    expect(res.code).toBe(0);

    // The assertion that matters: what the artifact actually says when run.
    expect(cargoRun()).toBe('demo 0.4.2');
  });

  it('the tree still builds when the host declares a version requirement', () => {
    // `version = "0.2"` is mandatory for a crate that also publishes to
    // crates.io. Bumping the core to 0.4.2 without moving this requirement
    // leaves `^0.2` unsatisfiable and cargo refuses to resolve.
    scaffold('0.2');
    const res = runCli(['write-crate-version', '--path', join(repo, 'host'), '--version', '0.4.2']);
    expect(res.code).toBe(0);

    expect(cargoRun()).toBe('demo 0.4.2');
  });

  it('leaves a compatible requirement satisfiable across a patch bump', () => {
    // The failure is intermittent by nature: a bump that stays inside the
    // requirement's range resolves fine, which is how a repo runs green for
    // months before a minor bump detonates it.
    scaffold('0.2');
    const res = runCli(['write-crate-version', '--path', join(repo, 'host'), '--version', '0.2.9']);
    expect(res.code).toBe(0);

    expect(cargoRun()).toBe('demo 0.2.9');
  });
});
