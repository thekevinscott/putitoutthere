/**
 * `polyglot-everything` structurally exercises the shape it claims — e2e.
 *
 * Issue #641. The fixture's own comment positions it as the reference
 * polyglot canary ("rust crate → python wheels (maturin) + multi-mode npm"),
 * and `notes/design-commitments.md` positions that shape as the v0 success
 * criterion. Structurally it does not mirror it, and that is plausibly why
 * the embedded-workspace-crate version bug shipped **twice** — #374, then
 * #621 — without either fixture suite catching it.
 *
 * The preconditions of that bug class, and what the fixture had:
 *
 *   pyo3 extension module path-deps the core   ->  depends only on pyo3
 *   everything in one cargo workspace          ->  no workspace root at all
 *   the core owns the version-bearing symbol   ->  main.rs prints "canary"
 *
 * With none of them present, "the artifact reports the release version" is
 * not a test anyone could have written here: there is nothing in the tree
 * whose `CARGO_PKG_VERSION` could ever diverge from the artifact's own.
 *
 * These tests are the canary that was missing. They copy the real fixture
 * tree, run the **real CLI's** maturin pre-build writer over it — the exact
 * command `_matrix.yml` runs before `maturin build` — and then ask **real
 * cargo** what the tree says. Cargo is the authority on purpose: the bug is
 * about a per-crate compile-time constant, so the reader that matters is the
 * one that would compile it.
 *
 * `cargo metadata --no-deps` reads manifests and resolves workspace
 * inheritance without touching the dependency graph, so this stays offline
 * and fast even though the fixture declares pyo3.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, '..', '..', 'dist', 'cli-bin.js');
const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures');

const FIXTURE = 'polyglot-everything';
const CORE_CRATE = 'piot-fixture-zzz-poly-rust';
const PY_CRATE = 'piot-fixture-zzz-python';
/** The version the pre-build writer is asked for; the artifact's version. */
const RELEASE = '0.4.2';
/** What `__VERSION__` starts at, so a stale literal is distinguishable. */
const BASE = '0.1.0';

interface CargoPackage {
  name: string;
  version: string;
  dependencies: Array<{ name: string; req: string }>;
}

let repo: string;

/** Copy the real fixture tree and materialize its `__VERSION__` slots. */
function prepareFixture(): void {
  repo = mkdtempSync(join(tmpdir(), `piot-${FIXTURE}-shape-`));
  cpSync(join(FIXTURES_DIR, FIXTURE), repo, { recursive: true });
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {walk(p);}
        continue;
      }
      const body = readFileSync(p, 'utf8');
      if (body.includes('__VERSION__')) {
        writeFileSync(p, body.replaceAll('__VERSION__', BASE), 'utf8');
      }
    }
  };
  walk(repo);
}

/** The real `write-version` CLI command, as `_matrix.yml` invokes it. */
function writeVersion(pkgDir: string, version: string): void {
  execFileSync('node', [CLI, 'write-version', '--path', pkgDir, '--version', version], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Real cargo's reading of a manifest. Throws if cargo cannot make sense of
 * it — which is itself the assertion for "is there a workspace here at all".
 */
function cargoMetadata(manifestRel: string): {
  packages: CargoPackage[];
  workspace_members: string[];
} {
  const raw = execFileSync(
    'cargo',
    ['metadata', '--no-deps', '--offline', '--format-version', '1', '--manifest-path', manifestRel],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(raw) as { packages: CargoPackage[]; workspace_members: string[] };
}

function packageNamed(manifestRel: string, name: string): CargoPackage {
  const pkg = cargoMetadata(manifestRel).packages.find((p) => p.name === name);
  if (pkg === undefined) {throw new Error(`cargo metadata did not report ${name}`);}
  return pkg;
}

beforeEach(prepareFixture);

afterEach(() => {
  if (repo) {rmSync(repo, { recursive: true, force: true });}
});

describe('polyglot-everything mirrors the shape it claims (#641)', () => {
  it('puts the core crate and the extension module in one cargo workspace', () => {
    // A workspace root is the precondition for `version.workspace = true`
    // (#428) and for the two crates being one build unit at all. Without it
    // cargo cannot even be asked about the tree as a whole.
    const meta = cargoMetadata('Cargo.toml');
    const members = meta.workspace_members.join(' ');
    expect(members).toContain(CORE_CRATE);
    expect(members).toContain(PY_CRATE);
  });

  it('has the extension module path-dep the core crate with a version requirement', () => {
    // The `version` key alongside `path` is mandatory for any crate that
    // also publishes to crates.io — and it is the half of #621 that turns a
    // stale bump into a hard resolution failure rather than a cosmetic
    // mismatch. A fixture without it cannot exercise the requirement
    // rewrite at all.
    const dep = packageNamed('packages/python/Cargo.toml', PY_CRATE).dependencies.find(
      (d) => d.name === CORE_CRATE,
    );
    expect(dep).toBeDefined();
    expect(dep!.req).toBe(`^${BASE}`);
  });

  it('carries the release version into the embedded core crate', () => {
    // This is the #374 / #621 bug, stated as a test. The wheel embeds the
    // core; the core owns the version-bearing symbol; nothing was bumping
    // it. Real cargo reports the version the compiler would bake in.
    writeVersion('packages/python', RELEASE);
    expect(packageNamed('packages/rust/Cargo.toml', CORE_CRATE).version).toBe(RELEASE);
  });

  it('moves the requirement pointing at the core along with it', () => {
    // The other half: bumping the core past the extension module's
    // requirement without moving the requirement makes cargo refuse to
    // resolve, so a fixture that pins only the version would still ship an
    // unbuildable tree.
    writeVersion('packages/python', RELEASE);
    const dep = packageNamed('packages/python/Cargo.toml', PY_CRATE).dependencies.find(
      (d) => d.name === CORE_CRATE,
    );
    expect(dep?.req).toBe(`^${RELEASE}`);
  });

  it(
    'builds a real binary that reports the release version',
    () => {
      // The assertion the fixture could not previously support. `main.rs`
      // printed a literal "canary": nothing in the tree had a
      // `CARGO_PKG_VERSION` whose value could ever be wrong, so "the
      // artifact reports the release version" was untestable here — which
      // is how the same bug shipped twice.
      //
      // This compiles the core for real and executes it. Cargo bakes
      // `CARGO_PKG_VERSION` in at compile time from the crate's on-disk
      // manifest, with no env override, so a binary printing 0.4.2 is proof
      // the rewrite reached the crate the compiler actually read — the one
      // claim no manifest assertion can make.
      writeVersion('packages/python', RELEASE);
      const printed = execFileSync('cargo', ['run', '-q', '-p', CORE_CRATE], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      expect(printed).toBe(RELEASE);
    },
    // A cold runner downloads and compiles the pyo3 tree the workspace
    // resolves before it can build the core; well outside the 60s default.
    180_000,
  );
});
