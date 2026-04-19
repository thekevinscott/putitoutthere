/**
 * `putitoutthere plan` tests. The planner composes config loading,
 * trailer parsing, cascade, and version bumping into a matrix-row
 * array consumed by the `build` job (and re-validated by `publish`).
 *
 * Issue #21. Plan: §12.4 (matrix contract), §11 (cascade), §10
 * (trailer), §14 (version).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { plan } from './plan.js';

let repo: string;
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
function commit(msg: string, files: Record<string, string> = {}): string {
  for (const [p, c] of Object.entries(files)) {
    const full = join(repo, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c, 'utf8');
  }
  git(['add', '-A']);
  git(['commit', '-m', msg, '--allow-empty']);
  return git(['rev-parse', 'HEAD']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'plan-test-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const PUTITOUTTHERE_TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "lib-rust"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]

[[package]]
name       = "lib-python"
kind       = "pypi"
path       = "packages/python"
pypi       = "lib"
build      = "maturin"
targets    = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
paths      = ["packages/python/**"]
depends_on = ["lib-rust"]
`;

describe('plan: first release (no tags)', () => {
  it('cascades every package and uses first_version', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    const names = matrix.map((r) => r.name);
    expect(names).toContain('lib-rust');
    expect(names).toContain('lib-python');
    // Default first_version.
    expect(matrix.every((r) => r.version === '0.1.0')).toBe(true);
  });

  it('emits crates row + per-target pypi rows + sdist row', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    const pypi = matrix.filter((r) => r.kind === 'pypi');
    const targets = pypi.map((r) => r.target);
    expect(targets).toContain('x86_64-unknown-linux-gnu');
    expect(targets).toContain('aarch64-apple-darwin');
    expect(targets).toContain('sdist');

    const crates = matrix.filter((r) => r.kind === 'crates');
    expect(crates).toHaveLength(1);
    expect(crates[0]!.target).toBe('noarch');
  });

  it('artifact_name follows the {name}-(crate|wheel-{target}|sdist) convention', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    expect(matrix.find((r) => r.name === 'lib-rust')!.artifact_name).toBe('lib-rust-crate');
    expect(matrix.find((r) => r.name === 'lib-python' && r.target === 'sdist')!.artifact_name).toBe(
      'lib-python-sdist',
    );
    expect(
      matrix.find(
        (r) => r.name === 'lib-python' && r.target === 'x86_64-unknown-linux-gnu',
      )!.artifact_name,
    ).toBe('lib-python-wheel-x86_64-unknown-linux-gnu');
  });
});

describe('plan: subsequent release with last_tag', () => {
  it('only cascades packages whose paths changed', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.1.0', '-m', 'r1']);
    git(['tag', '-a', 'lib-python-v0.1.0', '-m', 'p1']);

    commit('fix: only python', { 'packages/python/lib.py': '# python v2' });

    const matrix = await plan({ cwd: repo });
    expect(matrix.map((r) => r.name).sort()).toEqual([
      'lib-python', 'lib-python', 'lib-python',
    ]);
  });

  it('cascades python via depends_on when only rust files changed', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.1.0', '-m', 'r1']);
    git(['tag', '-a', 'lib-python-v0.1.0', '-m', 'p1']);

    commit('fix: only rust', { 'packages/rust/lib.rs': '// rust v2' });

    const matrix = await plan({ cwd: repo });
    const names = new Set(matrix.map((r) => r.name));
    expect(names).toContain('lib-rust');
    expect(names).toContain('lib-python');
  });

  it('default bump is patch from the last tag', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.3.4', '-m', 'r']);
    git(['tag', '-a', 'lib-python-v1.2.0', '-m', 'p']);

    commit('fix: x', { 'packages/rust/lib.rs': '// v2', 'packages/python/lib.py': '# v2' });

    const matrix = await plan({ cwd: repo });
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('0.3.5');
    expect(matrix.find((r) => r.name === 'lib-python')!.version).toBe('1.2.1');
  });

  it('release: minor trailer bumps minor for cascaded packages', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.1.0', '-m', 'r']);
    git(['tag', '-a', 'lib-python-v0.1.0', '-m', 'p']);

    commit('feat: add x\n\nrelease: minor', { 'packages/rust/lib.rs': '// v2' });

    const matrix = await plan({ cwd: repo });
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('0.2.0');
  });

  it('release: skip suppresses release entirely', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.1.0', '-m', 'r']);
    git(['tag', '-a', 'lib-python-v0.1.0', '-m', 'p']);

    commit('chore: typo\n\nrelease: skip', {
      'packages/rust/lib.rs': '// v2',
    });

    const matrix = await plan({ cwd: repo });
    expect(matrix).toEqual([]);
  });

  it('release: list scopes the bump to specific packages', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.1.0', '-m', 'r']);
    git(['tag', '-a', 'lib-python-v0.1.0', '-m', 'p']);

    commit('feat: x\n\nrelease: major [lib-python]', {
      'packages/rust/lib.rs': '// v2',
      'packages/python/lib.py': '# v2',
    });

    const matrix = await plan({ cwd: repo });
    // python gets major (listed); rust still cascades at default patch.
    expect(matrix.find((r) => r.name === 'lib-python')!.version).toBe('1.0.0');
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('0.1.1');
  });

  it('returns [] when no path changes match', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', '-a', 'lib-rust-v0.1.0', '-m', 'r']);
    git(['tag', '-a', 'lib-python-v0.1.0', '-m', 'p']);

    commit('docs: README', { 'README.md': 'hi' });

    const matrix = await plan({ cwd: repo });
    expect(matrix).toEqual([]);
  });
});

const NPM_TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "lib-ts"
kind  = "npm"
path  = "packages/ts"
paths = ["packages/ts/**"]
`;

const NPM_NAPI_TOML = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
paths   = ["packages/ts/**"]
build   = "napi"
targets = ["x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"]
`;

describe('plan: npm kinds', () => {
  it('vanilla npm emits a single noarch row', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), NPM_TOML, 'utf8');
    commit('feat: initial', { 'packages/ts/index.ts': 'export const x = 1;' });

    const matrix = await plan({ cwd: repo });
    expect(matrix).toHaveLength(1);
    expect(matrix[0]).toMatchObject({
      name: 'lib-ts',
      kind: 'npm',
      target: 'noarch',
      artifact_name: 'lib-ts-pkg',
      runs_on: 'ubuntu-latest',
    });
  });

  it('napi emits per-target rows + a main row', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), NPM_NAPI_TOML, 'utf8');
    commit('feat: initial', { 'packages/ts/index.ts': 'x' });

    const matrix = await plan({ cwd: repo });
    const targets = matrix.map((r) => r.target).sort();
    expect(targets).toEqual(['main', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']);
    const main = matrix.find((r) => r.target === 'main')!;
    expect(main.artifact_name).toBe('lib-napi-main');
    expect(main.runs_on).toBe('ubuntu-latest');
    const win = matrix.find((r) => r.target === 'x86_64-pc-windows-msvc')!;
    expect(win.runs_on).toBe('windows-latest');
    expect(win.artifact_name).toBe('lib-napi-x86_64-pc-windows-msvc');
  });
});

describe('plan: matrix row shape', () => {
  it('every row has the required fields', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    for (const row of matrix) {
      expect(row.name).toBeTruthy();
      expect(row.kind).toBeTruthy();
      expect(row.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(row.target).toBeTruthy();
      expect(row.runs_on).toBeTruthy();
      expect(row.artifact_name).toBeTruthy();
    }
  });

  it('runs_on defaults to ubuntu-latest for sdist + crates rows', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    expect(matrix.find((r) => r.name === 'lib-rust')!.runs_on).toBe('ubuntu-latest');
    expect(matrix.find((r) => r.name === 'lib-python' && r.target === 'sdist')!.runs_on).toBe(
      'ubuntu-latest',
    );
  });

  it('runs_on per target uses the platform-specific default', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    const linux = matrix.find(
      (r) => r.name === 'lib-python' && r.target === 'x86_64-unknown-linux-gnu',
    )!;
    expect(linux.runs_on).toBe('ubuntu-latest');
    const mac = matrix.find(
      (r) => r.name === 'lib-python' && r.target === 'aarch64-apple-darwin',
    )!;
    expect(mac.runs_on).toBe('macos-latest');
  });
});
