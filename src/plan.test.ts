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
globs = ["packages/rust/**"]

[[package]]
name       = "lib-python"
kind       = "pypi"
path       = "packages/python"
pypi       = "lib"
build      = "maturin"
targets    = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
globs      = ["packages/python/**"]
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

  // #230: `pkg.name` containing `/` (the polyglot-monorepo grouping
  // shape) used to flow through to artifact_name verbatim, which
  // actions/upload-artifact@v4 rejects. The planner now encodes `/`
  // to `__` so the round-trip works without consumer-side workarounds.
  it('encodes `/` in pkg.name to `__` for every artifact_name slot', async () => {
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `
[putitoutthere]
version = 1

[[package]]
name  = "rust/core"
kind  = "crates"
path  = "rust/core"
globs = ["rust/core/**"]

[[package]]
name       = "py/cachetta"
kind       = "pypi"
path       = "py/cachetta"
build      = "maturin"
targets    = ["x86_64-unknown-linux-gnu"]
globs      = ["py/cachetta/**"]

[[package]]
name    = "js/cachetta"
kind    = "npm"
build   = "napi"
path    = "js/cachetta"
targets = ["x86_64-unknown-linux-gnu"]
globs   = ["js/cachetta/**"]
`,
      'utf8',
    );
    commit('feat: initial', {
      'rust/core/lib.rs': '// rust',
      'py/cachetta/lib.py': '# python',
      'js/cachetta/index.js': '// js',
    });

    const matrix = await plan({ cwd: repo });
    const names = matrix.map((r) => r.artifact_name);

    // No artifact_name should contain a forward slash.
    for (const n of names) expect(n).not.toMatch(/\//);

    // Spot-check the encoded shapes per slot.
    expect(matrix.find((r) => r.name === 'rust/core')!.artifact_name).toBe(
      'rust__core-crate',
    );
    expect(
      matrix.find((r) => r.name === 'py/cachetta' && r.target === 'sdist')!.artifact_name,
    ).toBe('py__cachetta-sdist');
    expect(
      matrix.find(
        (r) => r.name === 'py/cachetta' && r.target === 'x86_64-unknown-linux-gnu',
      )!.artifact_name,
    ).toBe('py__cachetta-wheel-x86_64-unknown-linux-gnu');
    expect(matrix.find((r) => r.name === 'js/cachetta' && r.target === 'main')!.artifact_name).toBe(
      'js__cachetta-main',
    );
    expect(
      matrix.find(
        (r) => r.name === 'js/cachetta' && r.target === 'x86_64-unknown-linux-gnu',
      )!.artifact_name,
    ).toBe('js__cachetta-x86_64-unknown-linux-gnu');
  });

  // #237: `artifact_path` must be a directory shape (no glob). Glob
  // values produce nested upload-artifact layouts; the directory
  // shape uploads contents flat under `<artifact_name>/`.
  it('emits directory-shaped `artifact_path` for every slot (no glob)', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });

    const matrix = await plan({ cwd: repo });
    for (const row of matrix) {
      expect(row.artifact_path).not.toMatch(/\*/);
    }
    expect(matrix.find((r) => r.kind === 'crates')!.artifact_path).toBe(
      'packages/rust/target/package',
    );
    expect(
      matrix.find((r) => r.kind === 'pypi' && r.target === 'sdist')!.artifact_path,
    ).toBe('packages/python/dist');
    expect(
      matrix.find((r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu')!
        .artifact_path,
    ).toBe('packages/python/dist');
  });

  it('leaves the human-facing `name` field unchanged (encoding is artifact-side only)', async () => {
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `
[putitoutthere]
version = 1

[[package]]
name  = "py/cachetta"
kind  = "pypi"
path  = "py/cachetta"
globs = ["py/cachetta/**"]
`,
      'utf8',
    );
    commit('feat: initial', { 'py/cachetta/lib.py': '# python' });

    const matrix = await plan({ cwd: repo });
    expect(matrix.every((r) => r.name === 'py/cachetta')).toBe(true);
  });
});

describe('plan: subsequent release with last_tag', () => {
  it('only cascades packages whose globs changed', async () => {
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

  it('cascades correctly when multiple packages share a tag (diff memoization, #140)', async () => {
    // All three packages tag together at the same SHA. The memoized
    // diff cache must yield a single set that all three can iterate
    // against without one corrupting the others — this asserts the
    // correctness invariant of the #140 perf fix (shared Set is
    // read-only in the consumer chain).
    const sharedTomlStructure = `
[putitoutthere]
version = 1

[[package]]
name  = "pkg-a"
kind  = "crates"
path  = "packages/a"
globs = ["packages/a/**"]

[[package]]
name  = "pkg-b"
kind  = "crates"
path  = "packages/b"
globs = ["packages/b/**"]

[[package]]
name  = "pkg-c"
kind  = "crates"
path  = "packages/c"
globs = ["packages/c/**"]
`;
    writeFileSync(join(repo, 'putitoutthere.toml'), sharedTomlStructure, 'utf8');
    commit('feat: initial', {
      'packages/a/Cargo.toml': '[package]\nname="a"',
      'packages/b/Cargo.toml': '[package]\nname="b"',
      'packages/c/Cargo.toml': '[package]\nname="c"',
    });
    // All three tag at the same commit — this is the cache-hit scenario.
    git(['tag', '-a', 'pkg-a-v0.1.0', '-m', 'a']);
    git(['tag', '-a', 'pkg-b-v0.1.0', '-m', 'b']);
    git(['tag', '-a', 'pkg-c-v0.1.0', '-m', 'c']);

    // Change only pkg-b. Only pkg-b should cascade; pkg-a/pkg-c must
    // see the same diff set via the cache but correctly decide they
    // don't match their own path globs.
    commit('fix: only b', { 'packages/b/src.rs': '// b' });

    const matrix = await plan({ cwd: repo });
    expect(matrix.map((r) => r.name).sort()).toEqual(['pkg-b']);
  });
});

const NPM_TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "lib-ts"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`;

const NPM_NAPI_TOML = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
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

  it('honors per-target runner override on napi npm (#159)', async () => {
    const toml = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = "napi"
targets = [
  "x86_64-unknown-linux-gnu",
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" },
  { triple = "aarch64-apple-darwin",      runner = "macos-14" },
]
`;
    writeFileSync(join(repo, 'putitoutthere.toml'), toml, 'utf8');
    commit('feat: initial', { 'packages/ts/index.ts': 'x' });

    const matrix = await plan({ cwd: repo });
    // Bare string → hardcoded mapping default.
    const linux = matrix.find((r) => r.target === 'x86_64-unknown-linux-gnu')!;
    expect(linux.runs_on).toBe('ubuntu-latest');
    // Object form → runner override wins, even when the mapping default
    // would otherwise pick a different runner. macos-14 in particular
    // is never what the mapping would produce for aarch64-apple-darwin.
    const arm = matrix.find((r) => r.target === 'aarch64-unknown-linux-gnu')!;
    expect(arm.runs_on).toBe('ubuntu-24.04-arm');
    const mac = matrix.find((r) => r.target === 'aarch64-apple-darwin')!;
    expect(mac.runs_on).toBe('macos-14');
    // artifact_name and path still key off the triple, not the runner.
    expect(arm.artifact_name).toBe('lib-napi-aarch64-unknown-linux-gnu');
  });

  it('honors per-target runner override on maturin pypi (#159)', async () => {
    const toml = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-py"
kind    = "pypi"
path    = "packages/py"
globs   = ["packages/py/**"]
build   = "maturin"
targets = [
  "x86_64-unknown-linux-gnu",
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" },
]
`;
    writeFileSync(join(repo, 'putitoutthere.toml'), toml, 'utf8');
    commit('feat: initial', { 'packages/py/lib.py': '# py' });

    const matrix = await plan({ cwd: repo });
    const arm = matrix.find((r) => r.target === 'aarch64-unknown-linux-gnu')!;
    expect(arm.runs_on).toBe('ubuntu-24.04-arm');
    expect(arm.artifact_name).toBe('lib-py-wheel-aarch64-unknown-linux-gnu');
    // Bare string still falls back to mapping default.
    const linux = matrix.find((r) => r.target === 'x86_64-unknown-linux-gnu')!;
    expect(linux.runs_on).toBe('ubuntu-latest');
  });

  it('back-compat: string-only targets produce identical plan rows (#159)', async () => {
    // Two configs that should produce byte-identical plan output: one
    // with bare strings (historical shape), one with explicit object
    // form but no runner override. The object-form triple-only case
    // must degrade to the same behavior as the bare-string case.
    const bare = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = "napi"
targets = ["x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"]
`;
    writeFileSync(join(repo, 'putitoutthere.toml'), bare, 'utf8');
    commit('feat: initial', { 'packages/ts/index.ts': 'x' });
    const bareMatrix = await plan({ cwd: repo });

    // Reset the repo and rerun with the object-form equivalent.
    rmSync(repo, { recursive: true, force: true });
    repo = mkdtempSync(join(tmpdir(), 'plan-test-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'tag.gpgsign', 'false']);

    const objForm = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = "napi"
targets = [
  { triple = "x86_64-unknown-linux-gnu" },
  { triple = "x86_64-pc-windows-msvc" },
]
`;
    writeFileSync(join(repo, 'putitoutthere.toml'), objForm, 'utf8');
    commit('feat: initial', { 'packages/ts/index.ts': 'x' });
    const objMatrix = await plan({ cwd: repo });

    expect(objMatrix).toEqual(bareMatrix);
  });

  it('throws at plan time when a napi target triple is unmapped (#170)', () => {
    // Plan-time guard: a bogus triple (`mips64-unknown-linux-gnu`) has no
    // TRIPLE_MAP entry. Without this guard, the mistake surfaces only
    // mid-publish, after the CI matrix has already burned compute.
    const unmappedToml = `
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = "napi"
targets = ["x86_64-unknown-linux-gnu", "mips64-unknown-linux-gnu"]
`;
    writeFileSync(join(repo, 'putitoutthere.toml'), unmappedToml, 'utf8');
    commit('feat: initial', { 'packages/ts/index.ts': 'x' });

    // `plan()` throws synchronously from `rowsForPackage` before it
    // can wrap the result in a Promise, so assert on the synchronous
    // call rather than `.rejects`.
    expect(() => plan({ cwd: repo })).toThrow(
      /lib-napi.*mips64-unknown-linux-gnu.*TRIPLE_MAP.*src\/handlers\/npm-platform\.ts/,
    );
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

describe('plan: merge-commit trailer resolution', () => {
  it('reads the trailer from the feature parent when HEAD is a merge commit', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    // Seed main + tag so the cascade has something to diff against.
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', 'lib-rust-v0.1.0']);
    git(['tag', 'lib-python-v0.1.0']);

    // Feature branch: change + trailer on the feature tip.
    git(['checkout', '-b', 'feat']);
    commit('change rust\n\nrelease: minor', {
      'packages/rust/lib.rs': '// rust v2',
    });

    // Back to main, merge with --no-ff so a merge commit is created.
    // The merge commit body has no trailer; the trailer lives on the
    // second parent. parseTrailer on HEAD would return null.
    git(['checkout', 'main']);
    git(['merge', '--no-ff', 'feat', '-m', 'Merge pull request #1 from feat']);

    const matrix = await plan({ cwd: repo });
    // Without the fallback this would be empty (cascade runs, but the
    // bump defaults to patch → 0.1.1). With the fallback we see 0.2.0.
    const rust = matrix.find((r) => r.name === 'lib-rust');
    expect(rust?.version).toBe('0.2.0');
  });

  it('still prefers the HEAD trailer when present (non-merge commits)', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', 'lib-rust-v0.1.0']);
    git(['tag', 'lib-python-v0.1.0']);
    commit('change\n\nrelease: major', { 'packages/rust/lib.rs': '// rust v2' });

    const matrix = await plan({ cwd: repo });
    const rust = matrix.find((r) => r.name === 'lib-rust');
    expect(rust?.version).toBe('1.0.0');
  });

  it('returns null when neither HEAD nor merge parents carry a trailer', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML, 'utf8');
    commit('feat: initial', {
      'packages/rust/lib.rs': '// rust',
      'packages/python/lib.py': '# python',
    });
    git(['tag', 'lib-rust-v0.1.0']);
    git(['tag', 'lib-python-v0.1.0']);

    git(['checkout', '-b', 'feat']);
    commit('change rust (no trailer)', { 'packages/rust/lib.rs': '// rust v2' });
    git(['checkout', 'main']);
    git(['merge', '--no-ff', 'feat', '-m', 'Merge feat']);

    const matrix = await plan({ cwd: repo });
    // Default bump = patch.
    const rust = matrix.find((r) => r.name === 'lib-rust');
    expect(rust?.version).toBe('0.1.1');
  });
});

describe('plan: bundle_cli passthrough (#217)', () => {
  it('attaches bundle_cli to per-target wheel rows but NOT to the sdist row', async () => {
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `
[putitoutthere]
version = 1

[[package]]
name = "my-py"
kind = "pypi"
path = "py/my-py"
globs = ["py/my-py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "src/my_py/_binary"
crate_path = "crates/my-rust"
`,
      'utf8',
    );
    commit('seed', { 'py/my-py/pyproject.toml': 'x' });

    const matrix = await plan({ cwd: repo });
    const wheelRows = matrix.filter((r) => r.target !== 'sdist');
    const sdistRow = matrix.find((r) => r.target === 'sdist');

    // Every per-target wheel row carries bundle_cli.
    expect(wheelRows.length).toBe(2);
    for (const r of wheelRows) {
      expect(r.bundle_cli).toEqual({
        bin: 'my-cli',
        stage_to: 'src/my_py/_binary',
        crate_path: 'crates/my-rust',
      });
    }

    // Sdist row does not — it's source-only, no cross-compile happens.
    expect(sdistRow).toBeDefined();
    expect(sdistRow!.bundle_cli).toBeUndefined();
  });

  it('omits bundle_cli entirely when the package does not declare one', async () => {
    writeFileSync(join(repo, 'putitoutthere.toml'), PUTITOUTTHERE_TOML);
    commit('seed', { 'packages/rust/Cargo.toml': 'x' });

    const matrix = await plan({ cwd: repo });
    for (const r of matrix) {
      expect(r.bundle_cli).toBeUndefined();
    }
  });
});
