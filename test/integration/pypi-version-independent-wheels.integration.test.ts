/**
 * pypi version-independent wheels collapse the version fan — integration.
 *
 * Issue #401. A `kind = "pypi"` `build = "maturin"` package whose wheel is
 * Python-version-independent builds ONE wheel per platform that is
 * byte-identical no matter which interpreter built it:
 *
 *  - `[tool.maturin].bindings = "bin"` → a Rust-binary wheel tagged
 *    `py3-none-<platform>` (no Python ABI at all);
 *  - a pyo3 `abi3` / `abi3-pyXY` feature → a single stable-ABI extension
 *    tagged `cp3x-abi3-<platform>` that loads on every CPython >= X.Y.
 *
 * The planner still fans the maturin wheel build across every CPython
 * version `requires-python` (or an explicit `python_versions`) allows.
 * For a version-independent wheel that produces N *identical* wheels —
 * wasted build time, and N artifacts carrying the same filename that
 * then race-corrupt at the consumer's documented `merge-multiple: true`
 * download (`twine check` → `zipfile.BadZipFile`). The fix: collapse the
 * fan to a single wheel row per target for these packages.
 *
 * This lives in `test/integration/` because the behavior is only
 * observable when the real config loader, the real planner, and the real
 * `pyproject.toml` / `Cargo.toml` readers run together against an on-disk
 * repo — the config → plan → manifest seam a unit test with stubbed
 * inputs cannot exercise.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { plan, type MatrixRow } from '../../src/plan.js';

const TRIPLE = 'x86_64-unknown-linux-gnu';

// Deterministic three-version fan, independent of the checked-in
// released-CPython list (which `requires-python` inference expands
// against). The newest of this set is the build interpreter the
// collapsed single row should land on.
const PY3 = 'python_versions = ["3.11", "3.12", "3.13"]\n';

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-verindep-int-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function config(extra = ''): string {
  return `
[putitoutthere]
version = 1

[[package]]
name    = "demo-py"
kind    = "pypi"
path    = "pkg"
build   = "maturin"
targets = ["${TRIPLE}"]
globs   = ["pkg/**"]
${extra}`;
}

/** Seed a one-package maturin pypi repo and snapshot it as the first commit. */
function seed(opts: { pyproject: string; cargo?: string; configExtra?: string }): void {
  write('putitoutthere.toml', config(opts.configExtra ?? ''));
  write('pkg/pyproject.toml', opts.pyproject);
  if (opts.cargo !== undefined) {write('pkg/Cargo.toml', opts.cargo);}
  write('pkg/lib.rs', '// rust');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
}

/** Per-target wheel rows for the single declared triple. */
function wheelRows(matrix: MatrixRow[]): MatrixRow[] {
  return matrix.filter((r) => r.kind === 'pypi' && r.target === TRIPLE);
}

const pyVer = (r: MatrixRow): string | undefined =>
  (r as Record<string, unknown>)['python_version'] as string | undefined;

const PROJECT = '[project]\nname = "demo-py"\n';
const cargoWith = (features: string[]): string =>
  `[package]\nname = "demo-py"\n\n[dependencies]\npyo3 = { version = "0.22", features = [${features
    .map((f) => `"${f}"`)
    .join(', ')}] }\n`;

describe('pypi version-independent wheels collapse the fan (#401) — integration', () => {
  it('control: a plain pyo3 extension still fans across the resolved version set', async () => {
    // No abi3 feature and no `bindings = "bin"` → the wheel is genuinely
    // per-version, so the fan must stay. Guards the fix against
    // over-collapsing ordinary extension modules.
    seed({ pyproject: PROJECT, cargo: cargoWith(['extension-module']), configExtra: PY3 });
    const rows = wheelRows(await plan({ cwd: repo }));
    expect(rows.map((r) => r.artifact_name).sort()).toEqual([
      `demo-py-wheel-${TRIPLE}-py3.11`,
      `demo-py-wheel-${TRIPLE}-py3.12`,
      `demo-py-wheel-${TRIPLE}-py3.13`,
    ]);
  });

  it('bindings = "bin" emits a single, unsuffixed wheel row despite a multi-version fan', async () => {
    seed({ pyproject: `${PROJECT}\n[tool.maturin]\nbindings = "bin"\n`, configExtra: PY3 });
    const rows = wheelRows(await plan({ cwd: repo }));
    expect(rows).toHaveLength(1);
    // No `-py<ver>` suffix: a single wheel keeps the historical name.
    expect(rows[0]!.artifact_name).toBe(`demo-py-wheel-${TRIPLE}`);
    // Built once on the newest resolved interpreter.
    expect(pyVer(rows[0]!)).toBe('3.13');
  });

  it('a pyo3 abi3 feature in Cargo.toml emits a single, unsuffixed wheel row', async () => {
    seed({
      pyproject: PROJECT,
      cargo: cargoWith(['extension-module', 'abi3-py38']),
      configExtra: PY3,
    });
    const rows = wheelRows(await plan({ cwd: repo }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.artifact_name).toBe(`demo-py-wheel-${TRIPLE}`);
    expect(pyVer(rows[0]!)).toBe('3.13');
  });

  it('an abi3 feature routed through [tool.maturin].features also collapses the fan', async () => {
    seed({
      pyproject: `${PROJECT}\n[tool.maturin]\nfeatures = ["pyo3/abi3-py38"]\n`,
      cargo: cargoWith(['extension-module']),
      configExtra: PY3,
    });
    const rows = wheelRows(await plan({ cwd: repo }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.artifact_name).toBe(`demo-py-wheel-${TRIPLE}`);
  });

  it('collapses the inferred requires-python fan too (the real repro shape)', async () => {
    // No `python_versions` override — the set is inferred from a wide
    // `requires-python`, exactly the configuration that produced six
    // duplicate wheels in the field.
    seed({
      pyproject: '[project]\nname = "demo-py"\nrequires-python = ">=3.9"\n\n[tool.maturin]\nbindings = "bin"\n',
    });
    const rows = wheelRows(await plan({ cwd: repo }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.artifact_name).toBe(`demo-py-wheel-${TRIPLE}`);
    expect(pyVer(rows[0]!)).toBe('3.14');
  });

  it('the collapsed wheel still ships alongside exactly one sdist row', async () => {
    // The fan collapses to one wheel; the version-agnostic sdist is
    // unaffected. Two pypi rows total, no duplicate wheels to race.
    seed({
      pyproject: PROJECT,
      cargo: cargoWith(['extension-module', 'abi3-py38']),
      configExtra: PY3,
    });
    const pypi = (await plan({ cwd: repo })).filter((r) => r.kind === 'pypi');
    expect(wheelRows(pypi)).toHaveLength(1);
    expect(pypi.filter((r) => r.target === 'sdist')).toHaveLength(1);
    expect(pypi).toHaveLength(2);
  });
});
