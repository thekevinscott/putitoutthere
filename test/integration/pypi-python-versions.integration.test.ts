/**
 * pypi multi-version wheel matrix — integration test.
 *
 * Issue #369. `kind = "pypi"` builds a wheel for every CPython version
 * a package supports. The version set is resolved from the real
 * `putitoutthere.toml` (an explicit `python_versions` override) or,
 * failing that, the real `pyproject.toml` `[project].requires-python`.
 *
 * Lives in `test/integration/` because the behavior is only observable
 * when the real config loader, the real planner, and the real
 * `pyproject.toml` reader run together against an on-disk repo — a
 * unit test with a stubbed config or stubbed pyproject cannot see the
 * config → plan → pyproject seam this exercises.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { plan, type MatrixRow } from '../../src/plan.js';
import { RELEASED_CPYTHON_VERSIONS_ENV } from '../../src/python-versions.js';

let repo: string;
const ENV_BAK = process.env[RELEASED_CPYTHON_VERSIONS_ENV];

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-pyver-int-'));
  process.env[RELEASED_CPYTHON_VERSIONS_ENV] = '3.8,3.9,3.10,3.11,3.12,3.13,3.14';
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  if (ENV_BAK === undefined) {
    delete process.env[RELEASED_CPYTHON_VERSIONS_ENV];
  } else {
    process.env[RELEASED_CPYTHON_VERSIONS_ENV] = ENV_BAK;
  }
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
targets = ["x86_64-unknown-linux-gnu"]
globs   = ["pkg/**"]
${extra}`;
}

/** Seed a one-package pypi repo and snapshot it as the first commit. */
function seed(configExtra: string, pyproject: string): void {
  write('putitoutthere.toml', config(configExtra));
  write('pkg/pyproject.toml', pyproject);
  write('pkg/lib.rs', '// rust');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
}

/** Ascending list of `python_version`s on the per-target wheel rows. */
function wheelVersions(matrix: MatrixRow[]): string[] {
  return matrix
    .filter((r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu')
    .map((r) => (r as Record<string, unknown>)['python_version'] as string)
    .sort();
}

describe('pypi multi-version wheels (#369) — integration', () => {
  it('infers the wheel matrix from requires-python in pyproject.toml', async () => {
    seed('', '[project]\nname = "demo-py"\nrequires-python = ">=3.11"\n');
    const matrix = await plan({ cwd: repo });
    expect(wheelVersions(matrix)).toEqual(['3.11', '3.12', '3.13', '3.14']);
  });

  it('honors a requires-python upper bound', async () => {
    seed('', '[project]\nname = "demo-py"\nrequires-python = ">=3.10,<3.12"\n');
    const matrix = await plan({ cwd: repo });
    expect(wheelVersions(matrix)).toEqual(['3.10', '3.11']);
  });

  it('an explicit python_versions array overrides requires-python', async () => {
    seed(
      'python_versions = ["3.12", "3.13"]\n',
      '[project]\nname = "demo-py"\nrequires-python = ">=3.10"\n',
    );
    const matrix = await plan({ cwd: repo });
    expect(wheelVersions(matrix)).toEqual(['3.12', '3.13']);
  });

  it('an explicit python_versions array applies with no requires-python at all', async () => {
    seed('python_versions = ["3.10", "3.11"]\n', '[project]\nname = "demo-py"\n');
    const matrix = await plan({ cwd: repo });
    expect(wheelVersions(matrix)).toEqual(['3.10', '3.11']);
  });

  it('falls back to a single default wheel when neither is present', async () => {
    seed('', '[project]\nname = "demo-py"\n');
    const matrix = await plan({ cwd: repo });
    expect(wheelVersions(matrix)).toEqual(['3.12']);
  });

  it('multi-version wheels carry distinct, py-suffixed artifact names', async () => {
    seed('', '[project]\nname = "demo-py"\nrequires-python = ">=3.12"\n');
    const matrix = await plan({ cwd: repo });
    const names = matrix
      .filter((r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu')
      .map((r) => r.artifact_name)
      .sort();
    expect(names).toEqual([
      'demo-py-wheel-x86_64-unknown-linux-gnu-py3.12',
      'demo-py-wheel-x86_64-unknown-linux-gnu-py3.13',
      'demo-py-wheel-x86_64-unknown-linux-gnu-py3.14',
    ]);
  });
});
