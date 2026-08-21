/**
 * Pre-build version bump reaches EMBEDDED workspace crates — integration.
 *
 * Issue #621. #374 fixed "the shipped CLI prints a stale version" for the
 * `bundle_cli` path; the symptom returned byte-identical once the CLI moved
 * into a maturin extension module and a napi addon, because all three
 * pre-build writers bump only **the crate the build tool reads as its
 * version source**:
 *
 *   write-version        (#276) -> maturin's version source (`matrix.path`)
 *   write-crate-version  (#366) -> `bundle_cli.crate_path`
 *   napi pre-build step  (#429) -> the napi crate at `matrix.path`
 *
 * That invariant answers "what version is this artifact?" It does not answer
 * "whose `CARGO_PKG_VERSION` is observable *from* this artifact?" Those sets
 * are identical only when the artifact is one crate deep. The moment the
 * artifact embeds a sibling crate **by path** and that sibling owns the
 * version-bearing symbol (`clap`'s `#[command(version)]` expands
 * `env!("CARGO_PKG_VERSION")` inside the crate where it is written), nothing
 * bumps the sibling and the artifact ships a stale literal forever.
 *
 * `CARGO_PKG_VERSION` is a compile-time constant scoped per crate, read from
 * that crate's own on-disk `[package].version`. There is no env override --
 * not `CARGO_PKG_VERSION=... cargo build`, not `.cargo/config.toml [env]`
 * with `force = true`. Rewriting the manifest before the build is the only
 * lever, which is why this is putitoutthere's problem and not the consumer's.
 *
 * Two contracts are pinned here, and the second is the one that bites:
 *
 *  1. every in-repo crate the artifact compiles is bumped to the artifact's
 *     release version;
 *  2. every in-repo version **requirement** pointing at a bumped crate is
 *     rewritten too.
 *
 * Without (2) the fix is worse than the bug. A `dep = { path = "..",
 * version = "0.2" }` requirement -- which is *mandatory* for any crate that
 * also publishes to crates.io -- stops matching the moment the dependency is
 * bumped past it, and cargo refuses to resolve:
 *
 *     error: failed to select a version for the requirement `core = "^0.2"`
 *     candidate versions found which didn't match: 0.4.2
 *
 * That is a hard build failure (exit 101) before a line compiles, and it is
 * *intermittent*: a patch-cadence repo stays green for months and detonates
 * on the first bump that leaves the requirement's range.
 *
 * This lives in `tests/integration/` because the behavior is only observable
 * when the real manifest readers, the real workspace-root walk, and the real
 * dependency-graph walk run together against an on-disk cargo workspace --
 * a seam a unit test with stubbed inputs cannot exercise. The e2e twin
 * (`tests/e2e/embedded-crate-version.e2e.test.ts`) shells out to the built
 * CLI, then actually runs `cargo build` and executes the binary, which is
 * the only tier that can catch the resolution failure above: a
 * manifest-only assertion passes green on a tree that cannot build.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeCrateVersionForBuild } from '../../src/write-crate-version.js';
import { writeVersionForBuild } from '../../src/write-version.js';

let repo: string;

function write(rel: string, body: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

function read(rel: string): string {
  return readFileSync(join(repo, rel), 'utf8');
}

/** `[package].version` literal of the crate at `rel`. */
function pkgVersion(rel: string): string | undefined {
  const m = /\[package\][\s\S]*?^\s*version\s*=\s*"([^"]*)"/m.exec(read(rel));
  return m?.[1];
}

const WORKSPACE = '[workspace]\nmembers = ["core", "host"]\nresolver = "2"\n';

/** A core crate that owns the version-bearing symbol. */
function coreCrate(version: string): void {
  write('core/Cargo.toml', `[package]\nname = "demo-core"\nversion = "${version}"\nedition = "2021"\n`);
  write('core/src/lib.rs', 'pub fn version() -> &\'static str { env!("CARGO_PKG_VERSION") }\n');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-embedded-crate-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('maturin write-version (#276) reaches the embedded core crate', () => {
  beforeEach(() => {
    write('Cargo.toml', WORKSPACE);
    coreCrate('0.2.7');
    write(
      'host/pyproject.toml',
      '[project]\nname = "demo"\ndynamic = ["version"]\n\n[build-system]\nrequires = ["maturin>=1"]\nbuild-backend = "maturin"\n',
    );
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-py"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n',
    );
  });

  it('bumps the pyo3 crate the wheel is versioned from', async () => {
    await writeVersionForBuild(join(repo, 'host'), '0.4.2');
    expect(pkgVersion('host/Cargo.toml')).toBe('0.4.2');
  });

  it('bumps the embedded core crate that owns CARGO_PKG_VERSION', async () => {
    await writeVersionForBuild(join(repo, 'host'), '0.4.2');
    // The wheel embeds `demo-core`; `demo-core::version()` is what the CLI
    // prints. Left alone it reports the on-disk literal forever, because
    // putitoutthere never commits a version bump.
    expect(pkgVersion('core/Cargo.toml')).toBe('0.4.2');
  });

  it('rewrites the version requirement pointing at the bumped crate', async () => {
    await writeVersionForBuild(join(repo, 'host'), '0.4.2');
    // Without this, `^0.2` no longer matches 0.4.2 and cargo refuses to
    // resolve -- a hard build failure, not a cosmetic mismatch.
    expect(read('host/Cargo.toml')).toContain('version = "0.4.2"');
    expect(read('host/Cargo.toml')).not.toContain('version = "0.2"');
  });

  it('reports every manifest it rewrote', async () => {
    const written = await writeVersionForBuild(join(repo, 'host'), '0.4.2');
    expect(written).toEqual(
      expect.arrayContaining([join(repo, 'host', 'Cargo.toml'), join(repo, 'core', 'Cargo.toml')]),
    );
  });
});

describe('bundled-cli write-crate-version (#366) reaches the embedded core crate', () => {
  beforeEach(() => {
    write('Cargo.toml', WORKSPACE);
    coreCrate('0.2.7');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n',
    );
  });

  it('bumps the embedded core crate and its requirement', async () => {
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    expect(pkgVersion('core/Cargo.toml')).toBe('0.4.2');
    expect(read('host/Cargo.toml')).toContain('version = "0.4.2"');
  });
});

describe('every dependency table carries a requirement that can break resolution', () => {
  // Verified against cargo 1.94.1: a stale requirement in ANY of these
  // tables fails resolution identically. A fix that only handles
  // `[dependencies]` still ships an unbuildable tree.
  const tables = [
    ['dev-dependencies', '[dev-dependencies]'],
    ['build-dependencies', '[build-dependencies]'],
    ['target-specific', "[target.'cfg(unix)'.dependencies]"],
  ] as const;

  for (const [label, header] of tables) {
    it(`rewrites the requirement under ${label}`, async () => {
      write('Cargo.toml', WORKSPACE);
      coreCrate('0.2.7');
      write(
        'host/Cargo.toml',
        '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
          `${header}\ndemo-core = { path = "../core", version = "0.2" }\n`,
      );
      await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
      expect(read('host/Cargo.toml')).toContain('version = "0.4.2"');
      expect(read('host/Cargo.toml')).not.toContain('version = "0.2"');
    });
  }
});

describe('dependency declaration forms', () => {
  it('rewrites a section-table dependency ([dependencies.demo-core])', async () => {
    write('Cargo.toml', WORKSPACE);
    coreCrate('0.2.7');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies.demo-core]\npath = "../core"\nversion = "0.2"\nfeatures = ["cli"]\n',
    );
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    expect(read('host/Cargo.toml')).toContain('version = "0.4.2"');
    expect(read('host/Cargo.toml')).toContain('features = ["cli"]');
  });

  it('rewrites a [workspace.dependencies] requirement the member inherits', async () => {
    write(
      'Cargo.toml',
      '[workspace]\nmembers = ["core", "host"]\nresolver = "2"\n\n' +
        '[workspace.dependencies]\ndemo-core = { path = "core", version = "0.2" }\n',
    );
    coreCrate('0.2.7');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core.workspace = true\n',
    );
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    expect(pkgVersion('core/Cargo.toml')).toBe('0.4.2');
    // The requirement lives in the workspace root, not the member.
    expect(read('Cargo.toml')).toContain('version = "0.4.2"');
  });

  it('leaves a path dependency with no version requirement alone', async () => {
    write('Cargo.toml', WORKSPACE);
    coreCrate('0.2.7');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core = { path = "../core" }\n',
    );
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    expect(pkgVersion('core/Cargo.toml')).toBe('0.4.2');
    // Nothing to rewrite: a bare path dep always resolves.
    expect(read('host/Cargo.toml')).toContain('demo-core = { path = "../core" }');
  });
});

describe('scope: only in-repo path dependencies are touched', () => {
  it('never rewrites a registry dependency requirement', async () => {
    write('Cargo.toml', WORKSPACE);
    coreCrate('0.2.7');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-py"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n\n' +
        '[dependencies.pyo3]\nversion = "0.22"\nfeatures = ["extension-module"]\n',
    );
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    // pyo3 comes from crates.io. Rewriting its requirement to the release
    // version would pin a version that does not exist.
    expect(read('host/Cargo.toml')).toContain('version = "0.22"');
  });

  it('follows transitive path dependencies (host -> mid -> core)', async () => {
    write('Cargo.toml', '[workspace]\nmembers = ["core", "mid", "host"]\nresolver = "2"\n');
    coreCrate('0.2.7');
    write(
      'mid/Cargo.toml',
      '[package]\nname = "demo-mid"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core = { path = "../core", version = "0.2" }\n',
    );
    write('mid/src/lib.rs', 'pub use demo_core::version;\n');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-mid = { path = "../mid", version = "0.2" }\n',
    );
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    // The version-bearing crate is two hops away; the wheel still embeds it.
    expect(pkgVersion('core/Cargo.toml')).toBe('0.4.2');
    expect(pkgVersion('mid/Cargo.toml')).toBe('0.4.2');
    expect(read('mid/Cargo.toml')).toContain('version = "0.4.2"');
  });

  it('does not touch an unrelated workspace member the artifact never compiles', async () => {
    write('Cargo.toml', '[workspace]\nmembers = ["core", "host", "unrelated"]\nresolver = "2"\n');
    coreCrate('0.2.7');
    write(
      'unrelated/Cargo.toml',
      '[package]\nname = "demo-unrelated"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    write('unrelated/src/lib.rs', '\n');
    write(
      'host/Cargo.toml',
      '[package]\nname = "demo-cli"\nversion = "0.2.7"\nedition = "2021"\n\n' +
        '[dependencies]\ndemo-core = { path = "../core" }\n',
    );
    await writeCrateVersionForBuild(join(repo, 'host'), '0.4.2');
    // Membership is not the criterion -- reachability from the built crate
    // is. A sibling nobody depends on is not in the artifact.
    expect(pkgVersion('unrelated/Cargo.toml')).toBe('0.1.0');
  });
});
