/**
 * pypi maturin manylinux baseline — integration test.
 *
 * Issue #610. Linux wheels built on native runners are tagged with the
 * runner's glibc (`manylinux_2_39` on ubuntu-24.04 — see
 * thekevinscott/dirsql#818). An optional per-package `manylinux` key on
 * `kind = "pypi"` / `build = "maturin"` packages selects an older
 * baseline: the planner stamps it on each per-target linux wheel row,
 * and the reusable workflow forwards it to maturin-action's `manylinux`
 * input (which builds inside the matching manylinux container).
 *
 * Lives in `tests/integration/` because the behavior is only observable
 * when the real config loader and the real planner run together against
 * an on-disk repo — the config → plan seam is what carries the key.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { plan, type MatrixRow } from '../../src/plan.js';

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
  repo = mkdtempSync(join(tmpdir(), 'piot-manylinux-int-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function config(targets: string, extra = ''): string {
  return `
[putitoutthere]
version = 1

[[package]]
name    = "demo-py"
kind    = "pypi"
path    = "pkg"
build   = "maturin"
python_versions = ["3.12"]
targets = ${targets}
globs   = ["pkg/**"]
${extra}`;
}

/** Seed a one-package pypi repo and snapshot it as the first commit. */
function seed(targets: string, configExtra: string): void {
  write('putitoutthere.toml', config(targets, configExtra));
  write('pkg/pyproject.toml', '[project]\nname = "demo-py"\n');
  write('pkg/lib.rs', '// rust');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
}

function rowFor(matrix: MatrixRow[], target: string): MatrixRow {
  const row = matrix.find((r) => r.target === target);
  expect(row, `expected a matrix row for target ${target}`).toBeDefined();
  return row!;
}

/**
 * Read the row's `manylinux` via an index access so this file typechecks
 * before the field exists on `MatrixRow` — the same idiom
 * `pypi-python-versions.integration.test.ts` used for `python_version`
 * during its red phase.
 */
function ml(row: MatrixRow): unknown {
  return (row as unknown as Record<string, unknown>)['manylinux'];
}

const ALL_TARGETS = `[
  "x86_64-unknown-linux-gnu",
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" },
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
]`;

describe('pypi maturin manylinux baseline (#610) — integration', () => {
  it('stamps the configured manylinux on every linux-gnu wheel row', async () => {
    seed(ALL_TARGETS, 'manylinux = "2_28"\n');
    const matrix = await plan({ cwd: repo });
    expect(ml(rowFor(matrix, 'x86_64-unknown-linux-gnu'))).toBe('2_28');
    expect(ml(rowFor(matrix, 'aarch64-unknown-linux-gnu'))).toBe('2_28');
  });

  it('leaves non-linux wheel rows and the sdist row unstamped', async () => {
    seed(ALL_TARGETS, 'manylinux = "2_28"\n');
    const matrix = await plan({ cwd: repo });
    expect(ml(rowFor(matrix, 'x86_64-apple-darwin'))).toBeUndefined();
    expect(ml(rowFor(matrix, 'x86_64-pc-windows-msvc'))).toBeUndefined();
    expect(ml(rowFor(matrix, 'sdist'))).toBeUndefined();
  });

  it('when the key is absent, no row carries manylinux (current behavior preserved)', async () => {
    seed(ALL_TARGETS, '');
    const matrix = await plan({ cwd: repo });
    for (const row of matrix) {
      expect(ml(row), `row ${row.target} must not carry manylinux`).toBeUndefined();
    }
  });

  it('a manylinux value applies to gnu triples, not musl triples', async () => {
    seed(
      '["x86_64-unknown-linux-gnu", "x86_64-unknown-linux-musl"]',
      'manylinux = "2_28"\n',
    );
    const matrix = await plan({ cwd: repo });
    expect(ml(rowFor(matrix, 'x86_64-unknown-linux-gnu'))).toBe('2_28');
    expect(ml(rowFor(matrix, 'x86_64-unknown-linux-musl'))).toBeUndefined();
  });

  it('a musllinux value applies to musl triples, not gnu triples', async () => {
    seed(
      '["x86_64-unknown-linux-gnu", "x86_64-unknown-linux-musl"]',
      'manylinux = "musllinux_1_2"\n',
    );
    const matrix = await plan({ cwd: repo });
    expect(ml(rowFor(matrix, 'x86_64-unknown-linux-musl'))).toBe('musllinux_1_2');
    expect(ml(rowFor(matrix, 'x86_64-unknown-linux-gnu'))).toBeUndefined();
  });

  it('rejects manylinux on a non-maturin pypi package', async () => {
    write(
      'putitoutthere.toml',
      `
[putitoutthere]
version = 1

[[package]]
name  = "demo-py"
kind  = "pypi"
path  = "pkg"
build = "hatch"
manylinux = "2_28"
globs = ["pkg/**"]
`,
    );
    write('pkg/pyproject.toml', '[project]\nname = "demo-py"\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
    await expect(plan({ cwd: repo })).rejects.toThrow(
      /manylinux is only valid when build = "maturin"/,
    );
  });

  it('rejects a malformed manylinux value', async () => {
    seed('["x86_64-unknown-linux-gnu"]', 'manylinux = "glibc-2.28"\n');
    await expect(plan({ cwd: repo })).rejects.toThrow(/manylinux must be/);
  });
});
