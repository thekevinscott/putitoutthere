/**
 * `putitoutthere plan` tests. The planner composes config loading,
 * trailer parsing, cascade, and version bumping into a matrix-row
 * array consumed by the `build` job (and re-validated by `publish`).
 *
 * Issue #21. Plan: §12.4 (matrix contract), §11 (cascade), §10
 * (trailer), §14 (version).
 *
 * Isolation: this suite drives `plan`'s real config parse, cascade,
 * version-bump, and row-building logic while mocking only its I/O
 * collaborators — `readFileSync` (so `loadConfig` sees each test's
 * TOML), the `git.js` observers (`headCommit`/`lastTag`/`diffNames`/
 * `commitBody`/`commitParents`), and the two pypi helpers
 * (`resolvePythonVersions`, `isVersionIndependentWheel`). `config.js`,
 * `cascade.js`, `version.js`, `tag-template.js`, and the npm-platform
 * helpers run for real, so every assertion below exercises the
 * planner's genuine output.
 */

import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitBody, commitParents, diffNames, headCommit, lastTag } from './git.js';
import { plan } from './plan.js';
import { resolvePythonVersions } from './python-versions.js';
import { isVersionIndependentWheel } from './wheel-abi.js';

// Mock only the I/O boundary. `readFile` is driven so `loadConfig`'s
// real `parseConfig` runs on each test's TOML; the `git.js` observers are
// driven to describe the repo state the planner would otherwise read from
// a real temp git repo; the pypi helpers are driven so the planner's
// version-fan logic is exercised without touching the filesystem.
vi.mock('node:fs/promises');
vi.mock('./git.js');
vi.mock('./python-versions.js');
vi.mock('./wheel-abi.js');

// The planner treats `cwd` opaquely (it only threads it into the mocked
// collaborators), so any string does. No path literals are asserted.
const CWD = 'repo';
const HEAD = 'HEADSHA';

/** Drive `loadConfig` to see `toml` as the `putitoutthere.toml` contents. */
function useToml(toml: string): void {
  vi.mocked(readFile).mockResolvedValue(toml);
}

/** The commit message the planner reads the `release:` trailer from. */
function setHeadBody(msg: string): void {
  vi.mocked(commitBody).mockResolvedValue(msg);
}

/**
 * Build a `lastTag` result from a tag whose trailing segment is `X.Y.Z`
 * — mirrors the real resolver, which now hands back the parsed version
 * alongside the tag so callers never re-parse.
 */
function tagResult(tag: string): { tag: string; version: { major: number; minor: number; patch: number } } {
  const m = /(\d+)\.(\d+)\.(\d+)$/.exec(tag)!;
  return { tag, version: { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } };
}

/** Map each package name to its resolved last tag (or absent → first release). */
function setTags(tags: Record<string, string>): void {
  vi.mocked(lastTag).mockImplementation((name: string) => {
    const tag = tags[name];
    return Promise.resolve(tag === undefined ? null : tagResult(tag));
  });
}

/** Map each tag to the file paths changed since it (drives the cascade). */
function setDiff(byTag: Record<string, string[]>): void {
  vi.mocked(diffNames).mockImplementation((from: string) => Promise.resolve(byTag[from] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sane defaults: HEAD is a plain, trailer-less, non-merge commit and no
  // package has a tag (the first-release shape). Tests override per case.
  vi.mocked(headCommit).mockResolvedValue(HEAD);
  vi.mocked(commitBody).mockResolvedValue('feat: initial');
  vi.mocked(commitParents).mockResolvedValue(['parent']);
  vi.mocked(lastTag).mockResolvedValue(null);
  vi.mocked(diffNames).mockResolvedValue([]);
  vi.mocked(isVersionIndependentWheel).mockResolvedValue(false);
  // Restore the real resolution shape the prior factory encoded: an
  // explicit `python_versions` is sorted numerically, else a single
  // default. The resolution logic itself is covered by
  // python-versions.test.ts and the integration suite.
  vi.mocked(resolvePythonVersions).mockImplementation((pkg) => {
    if (pkg.python_versions !== undefined) {
      return Promise.resolve(
        [...pkg.python_versions].sort((a, b) => {
        const av = a.split('.').map(Number);
        const bv = b.split('.').map(Number);
        for (let i = 0; i < Math.max(av.length, bv.length); i++) {
          const d = (av[i] ?? 0) - (bv[i] ?? 0);
          if (d !== 0) {return d;}
        }
        return 0;
        }),
      );
    }
    return Promise.resolve(['3.12']);
  });
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
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
    const names = matrix.map((r) => r.name);
    expect(names).toContain('lib-rust');
    expect(names).toContain('lib-python');
    // Default first_version.
    expect(matrix.every((r) => r.version === '0.1.0')).toBe(true);
  });

  it('emits crates row + per-target pypi rows + sdist row', async () => {
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
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
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
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
    useToml(`
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
`);

    const matrix = await plan({ cwd: CWD });
    const names = matrix.map((r) => r.artifact_name);

    // No artifact_name should contain a forward slash.
    for (const n of names) {expect(n).not.toMatch(/\//);}

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
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
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
    useToml(`
[putitoutthere]
version = 1

[[package]]
name  = "py/cachetta"
kind  = "pypi"
path  = "py/cachetta"
globs = ["py/cachetta/**"]
`);

    const matrix = await plan({ cwd: CWD });
    expect(matrix.every((r) => r.name === 'py/cachetta')).toBe(true);
  });
});

describe('plan: subsequent release with last_tag', () => {
  it('only cascades packages whose globs changed', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    // Both packages tagged at the same seed commit; the only change since
    // is to python, so both tags diff to the same python-only file set.
    setDiff({
      'lib-rust-v0.1.0': ['packages/python/lib.py'],
      'lib-python-v0.1.0': ['packages/python/lib.py'],
    });
    setHeadBody('fix: only python');

    const matrix = await plan({ cwd: CWD });
    expect(matrix.map((r) => r.name).sort()).toEqual([
      'lib-python', 'lib-python', 'lib-python',
    ]);
  });

  it('cascades python via depends_on when only rust files changed', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['packages/rust/lib.rs'],
      'lib-python-v0.1.0': ['packages/rust/lib.rs'],
    });
    setHeadBody('fix: only rust');

    const matrix = await plan({ cwd: CWD });
    const names = new Set(matrix.map((r) => r.name));
    expect(names).toContain('lib-rust');
    expect(names).toContain('lib-python');
  });

  it('default bump is patch from the last tag', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.3.4', 'lib-python': 'lib-python-v1.2.0' });
    setDiff({
      'lib-rust-v0.3.4': ['packages/rust/lib.rs', 'packages/python/lib.py'],
      'lib-python-v1.2.0': ['packages/rust/lib.rs', 'packages/python/lib.py'],
    });
    setHeadBody('fix: x');

    const matrix = await plan({ cwd: CWD });
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('0.3.5');
    expect(matrix.find((r) => r.name === 'lib-python')!.version).toBe('1.2.1');

    // Every `lastTag` call — from both `collectChanges` (plan.ts:211) and
    // `nextVersion` (plan.ts:232) — must carry the `{ cwd }` options
    // object. Checking *every* call (not just "some call matched") kills
    // the `{ cwd } -> {}` mutant at either site independently, since both
    // fire here with identical name/format args.
    for (const call of vi.mocked(lastTag).mock.calls) {
      expect(call[2]).toEqual({ cwd: CWD });
    }
    // `diffNames` is threaded the seed tag, the literal 'HEAD' ref, and
    // `{ cwd }` (plan.ts:218 — kills both the 'HEAD'->"" and {cwd}->{}
    // mutants; single call site, so a targeted match is exact).
    expect(vi.mocked(diffNames)).toHaveBeenCalledWith('lib-rust-v0.3.4', 'HEAD', { cwd: CWD });
  });

  it('plans first_version when a package has no resolvable last tag', async () => {
    // `lastTag` now filters any candidate whose version part fails strict
    // semver (git.test.ts pins that), handing back the already-parsed
    // version or null — never a malformed tag for the planner to re-parse.
    // A repo whose only tag is unparseable therefore resolves to no last
    // tag, and the planner plans the first release at first_version.
    useToml(`
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/lib"
globs = ["packages/lib/**"]
`);
    vi.mocked(lastTag).mockResolvedValue(null);
    setHeadBody('fix: x');

    const matrix = await plan({ cwd: CWD });
    // No prior tag → first release at first_version (0.1.0 default).
    expect(matrix.find((r) => r.name === 'lib')!.version).toBe('0.1.0');
  });

  it('reuses a memoized diff when two packages resolve to the same last tag (#140)', async () => {
    // Both packages share a tag_format and land on the SAME tag string, so
    // the second seed-detection pass hits the diff cache — the
    // `diff === undefined` guard is false on that pass.
    useToml(`
[putitoutthere]
version = 1

[[package]]
name       = "a"
kind       = "crates"
path       = "packages/a"
globs      = ["packages/a/**"]
tag_format = "shared-v{version}"

[[package]]
name       = "b"
kind       = "crates"
path       = "packages/b"
globs      = ["packages/b/**"]
tag_format = "shared-v{version}"
`);
    setTags({ a: 'shared-v1.0.0', b: 'shared-v1.0.0' });
    setDiff({ 'shared-v1.0.0': ['packages/a/x.rs', 'packages/b/y.rs'] });
    setHeadBody('fix: x');

    const matrix = await plan({ cwd: CWD });
    expect(matrix.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });

  it('release: minor trailer bumps minor for cascaded packages', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['packages/rust/lib.rs'],
      'lib-python-v0.1.0': ['packages/rust/lib.rs'],
    });
    setHeadBody('feat: add x\n\nrelease: minor');

    const matrix = await plan({ cwd: CWD });
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('0.2.0');
  });

  it('release: skip suppresses release entirely', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setHeadBody('chore: typo\n\nrelease: skip');

    const matrix = await plan({ cwd: CWD });
    expect(matrix).toEqual([]);
  });

  it('release: list scopes the bump to specific packages', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['packages/rust/lib.rs', 'packages/python/lib.py'],
      'lib-python-v0.1.0': ['packages/rust/lib.rs', 'packages/python/lib.py'],
    });
    setHeadBody('feat: x\n\nrelease: major [lib-python]');

    const matrix = await plan({ cwd: CWD });
    // python gets major (listed); rust still cascades at default patch.
    expect(matrix.find((r) => r.name === 'lib-python')!.version).toBe('1.0.0');
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('0.1.1');
  });

  it('returns [] when no path changes match', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['README.md'],
      'lib-python-v0.1.0': ['README.md'],
    });
    setHeadBody('docs: README');

    const matrix = await plan({ cwd: CWD });
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
    useToml(sharedTomlStructure);
    // All three tag at the same commit — this is the cache-hit scenario.
    setTags({ 'pkg-a': 'pkg-a-v0.1.0', 'pkg-b': 'pkg-b-v0.1.0', 'pkg-c': 'pkg-c-v0.1.0' });
    // Change only pkg-b. Only pkg-b should cascade; pkg-a/pkg-c must
    // see the same diff set via the cache but correctly decide they
    // don't match their own path globs.
    setDiff({
      'pkg-a-v0.1.0': ['packages/b/src.rs'],
      'pkg-b-v0.1.0': ['packages/b/src.rs'],
      'pkg-c-v0.1.0': ['packages/b/src.rs'],
    });
    setHeadBody('fix: only b');

    const matrix = await plan({ cwd: CWD });
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
    useToml(NPM_TOML);

    const matrix = await plan({ cwd: CWD });
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
    useToml(NPM_NAPI_TOML);

    const matrix = await plan({ cwd: CWD });
    const targets = matrix.map((r) => r.target).sort();
    expect(targets).toEqual(['main', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']);
    const main = matrix.find((r) => r.target === 'main')!;
    expect(main.artifact_name).toBe('lib-napi-main');
    expect(main.runs_on).toBe('ubuntu-latest');
    const win = matrix.find((r) => r.target === 'x86_64-pc-windows-msvc')!;
    // Pinned to windows-2022 (not windows-latest) so consumer releases don't
    // silently migrate to VS2026 on 2026-06-15 when GitHub flips
    // windows-latest → windows-2025-vs2026. See issue #354.
    expect(win.runs_on).toBe('windows-2022');
    expect(win.artifact_name).toBe('lib-napi-x86_64-pc-windows-msvc');
  });

  it('honors per-target runner override on napi npm (#159)', async () => {
    useToml(`
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
`);

    const matrix = await plan({ cwd: CWD });
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

  it('defaults a bare aarch64-linux maturin target to the native arm runner (#354)', async () => {
    // A bare-string aarch64-linux target (no `{ triple, runner }` override)
    // falls to defaultRunsOn, which maps aarch64-linux → ubuntu-24.04-arm.
    useToml(`
[putitoutthere]
version = 1

[[package]]
name    = "lib-py"
kind    = "pypi"
path    = "packages/py"
globs   = ["packages/py/**"]
build   = "maturin"
targets = ["aarch64-unknown-linux-gnu"]
`);

    const matrix = await plan({ cwd: CWD });
    const arm = matrix.find((r) => r.target === 'aarch64-unknown-linux-gnu')!;
    expect(arm.runs_on).toBe('ubuntu-24.04-arm');
  });

  it('honors per-target runner override on maturin pypi (#159)', async () => {
    useToml(`
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
`);

    const matrix = await plan({ cwd: CWD });
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
    useToml(bare);
    const bareMatrix = await plan({ cwd: CWD });

    // Rerun with the object-form equivalent.
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
    useToml(objForm);
    const objMatrix = await plan({ cwd: CWD });

    expect(objMatrix).toEqual(bareMatrix);
  });

  it('multi-mode npm (#dirsql) emits per-(mode, triple) rows with mode-infix artifact names', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name    = "dirsql"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = [
  { mode = "napi",        name = "@dirsql/lib-{triple}" },
  { mode = "bundled-cli", name = "@dirsql/cli-{triple}" },
]
targets = ["linux-x64-gnu", "darwin-arm64"]
`);

    const matrix = await plan({ cwd: CWD });
    // 2 modes × 2 triples + 1 main row = 5 total
    expect(matrix).toHaveLength(5);

    const napiLinux = matrix.find(
      (r) => r.target === 'linux-x64-gnu' && r.build === 'napi',
    )!;
    expect(napiLinux.artifact_name).toBe('dirsql-napi-linux-x64-gnu');
    expect(napiLinux.artifact_path).toBe('packages/ts/build/napi-linux-x64-gnu');

    const cliLinux = matrix.find(
      (r) => r.target === 'linux-x64-gnu' && r.build === 'bundled-cli',
    )!;
    expect(cliLinux.artifact_name).toBe('dirsql-bundled-cli-linux-x64-gnu');
    expect(cliLinux.artifact_path).toBe('packages/ts/build/bundled-cli-linux-x64-gnu');

    const napiDarwin = matrix.find(
      (r) => r.target === 'darwin-arm64' && r.build === 'napi',
    )!;
    expect(napiDarwin.artifact_name).toBe('dirsql-napi-darwin-arm64');

    const main = matrix.find((r) => r.target === 'main')!;
    expect(main.artifact_name).toBe('dirsql-main');
    // Main row carries the first mode for backward compat with single-mode shape.
    expect(main.build).toBe('napi');
  });

  it('single-entry array form preserves single-mode artifact naming (no mode infix)', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = ["napi"]
targets = ["x86_64-unknown-linux-gnu"]
`);

    const matrix = await plan({ cwd: CWD });
    const linux = matrix.find((r) => r.target === 'x86_64-unknown-linux-gnu')!;
    // Length-1 array equivalent to string form: no mode infix.
    expect(linux.artifact_name).toBe('lib-napi-x86_64-unknown-linux-gnu');
    expect(linux.artifact_path).toBe('packages/ts/build/x86_64-unknown-linux-gnu');
  });

  it('throws at plan time when a napi target triple is unmapped (#170)', async () => {
    // Plan-time guard: a bogus triple (`mips64-unknown-linux-gnu`) has no
    // TRIPLE_MAP entry. Without this guard, the mistake surfaces only
    // mid-publish, after the CI matrix has already burned compute.
    useToml(`
[putitoutthere]
version = 1

[[package]]
name    = "lib-napi"
kind    = "npm"
path    = "packages/ts"
globs   = ["packages/ts/**"]
build   = "napi"
targets = ["x86_64-unknown-linux-gnu", "mips64-unknown-linux-gnu"]
`);

    // `plan()` is async, so the plan-time guard in `rowsForPackage`
    // surfaces as a rejection.
    await expect(plan({ cwd: CWD })).rejects.toThrow(
      /lib-napi.*mips64-unknown-linux-gnu.*TRIPLE_MAP.*src\/handlers\/npm-platform\.ts/,
    );
  });
});

describe('plan: matrix row shape', () => {
  it('every row has the required fields', async () => {
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
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
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
    expect(matrix.find((r) => r.name === 'lib-rust')!.runs_on).toBe('ubuntu-latest');
    expect(matrix.find((r) => r.name === 'lib-python' && r.target === 'sdist')!.runs_on).toBe(
      'ubuntu-latest',
    );
  });

  it('runs_on per target uses the platform-specific default', async () => {
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
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
    useToml(PUTITOUTTHERE_TOML);
    // Seed main + tag so the cascade has something to diff against.
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['packages/rust/lib.rs'],
      'lib-python-v0.1.0': ['packages/rust/lib.rs'],
    });
    // HEAD is a merge commit: its body has no trailer; the trailer lives
    // on the second (feature) parent whose message carried `release: minor`.
    vi.mocked(commitParents).mockResolvedValue(['main-parent', 'feat-parent']);
    vi.mocked(commitBody).mockImplementation((sha: string) =>
      Promise.resolve(
        sha === 'feat-parent'
          ? 'change rust\n\nrelease: minor'
          : 'Merge pull request #1 from feat',
      ),
    );

    const matrix = await plan({ cwd: CWD });
    // Without the fallback this would be empty (cascade runs, but the
    // bump defaults to patch → 0.1.1). With the fallback we see 0.2.0.
    const rust = matrix.find((r) => r.name === 'lib-rust');
    expect(rust?.version).toBe('0.2.0');

    // The change-detection collaborators must all be threaded the caller's
    // `cwd` (pins the `{ cwd }` options object against `{}` mutants, and
    // the trailer-resolution first-arg identities against being swapped):
    //   headCommit({ cwd })            — plan.ts:107
    //   commitBody(HEAD, { cwd })      — plan.ts:507 (direct HEAD body)
    //   commitParents(HEAD, { cwd })   — plan.ts:509
    //   commitBody('feat-parent', …)   — plan.ts:513 (merge-parent body)
    expect(vi.mocked(headCommit)).toHaveBeenCalledWith({ cwd: CWD });
    expect(vi.mocked(commitBody)).toHaveBeenCalledWith(HEAD, { cwd: CWD });
    expect(vi.mocked(commitParents)).toHaveBeenCalledWith(HEAD, { cwd: CWD });
    expect(vi.mocked(commitBody)).toHaveBeenCalledWith('feat-parent', { cwd: CWD });
  });

  it('still prefers the HEAD trailer when present (non-merge commits)', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['packages/rust/lib.rs'],
      'lib-python-v0.1.0': ['packages/rust/lib.rs'],
    });
    setHeadBody('change\n\nrelease: major');

    const matrix = await plan({ cwd: CWD });
    const rust = matrix.find((r) => r.name === 'lib-rust');
    expect(rust?.version).toBe('1.0.0');
  });

  it('returns null when neither HEAD nor merge parents carry a trailer', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v0.1.0', 'lib-python': 'lib-python-v0.1.0' });
    setDiff({
      'lib-rust-v0.1.0': ['packages/rust/lib.rs'],
      'lib-python-v0.1.0': ['packages/rust/lib.rs'],
    });
    vi.mocked(commitParents).mockResolvedValue(['main-parent', 'feat-parent']);
    vi.mocked(commitBody).mockImplementation((sha: string) =>
      Promise.resolve(sha === 'feat-parent' ? 'change rust (no trailer)' : 'Merge feat'),
    );

    const matrix = await plan({ cwd: CWD });
    // Default bump = patch.
    const rust = matrix.find((r) => r.name === 'lib-rust');
    expect(rust?.version).toBe('0.1.1');
  });
});

describe('plan: bundle_cli passthrough (#217)', () => {
  it('attaches bundle_cli to per-target wheel rows but NOT to the sdist row', async () => {
    useToml(`
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
`);

    const matrix = await plan({ cwd: CWD });
    const wheelRows = matrix.filter((r) => r.target !== 'sdist');
    const sdistRow = matrix.find((r) => r.target === 'sdist');

    // Every per-target wheel row carries bundle_cli.
    expect(wheelRows.length).toBe(2);
    for (const r of wheelRows) {
      expect(r.bundle_cli).toEqual({
        bin: 'my-cli',
        stage_to: 'src/my_py/_binary',
        crate_path: 'crates/my-rust',
        features: [],
        no_default_features: false,
      });
    }

    // Sdist row does not — it's source-only, no cross-compile happens.
    expect(sdistRow).toBeDefined();
    expect(sdistRow!.bundle_cli).toBeUndefined();
  });

  it('omits bundle_cli entirely when the package does not declare one', async () => {
    useToml(PUTITOUTTHERE_TOML);

    const matrix = await plan({ cwd: CWD });
    for (const r of matrix) {
      expect(r.bundle_cli).toBeUndefined();
    }
  });

  // #300: features / no_default_features get plumbed through the planner so
  // the matrix workflow can pass them to `cargo build`.
  it('passes features and no_default_features through to per-target wheel rows', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-py"
kind = "pypi"
path = "py/my-py"
globs = ["py/my-py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "src/my_py/_binary"
crate_path = "crates/my-rust"
features = ["cli"]
no_default_features = true
`);

    const matrix = await plan({ cwd: CWD });
    const wheelRow = matrix.find((r) => r.target !== 'sdist');
    expect(wheelRow?.bundle_cli).toEqual({
      bin: 'my-cli',
      stage_to: 'src/my_py/_binary',
      crate_path: 'crates/my-rust',
      features: ['cli'],
      no_default_features: true,
    });
  });
});

// #324: pure-Python hatch packages used to plan only an sdist row, so PyPI
// received no wheel and downstream `uvx` / `pip install` had to provision
// hatchling and run `python -m build` on a cold cache. `pypa/build`'s
// default behavior on a pure-Python tree is to produce both sdist AND
// wheel, so the planner must ask for both.
describe('plan: hatch emits sdist + wheel-any (#324)', () => {
  const TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "py-hatch"
kind  = "pypi"
path  = "py"
globs = ["py/**"]
build = "hatch"
`;

  it('emits an sdist row AND a wheel-any row for a pure-Python hatch package', async () => {
    useToml(TOML);

    const matrix = await plan({ cwd: CWD });
    const targets = matrix.map((r) => r.target).sort();
    expect(targets).toEqual(['any', 'sdist']);
  });

  it('wheel-any row uses artifact_name `<safe>-wheel-any` and carries build = "hatch"', async () => {
    useToml(TOML);

    const matrix = await plan({ cwd: CWD });
    const wheel = matrix.find((r) => r.target === 'any');
    expect(wheel).toBeDefined();
    expect(wheel!.artifact_name).toBe('py-hatch-wheel-any');
    expect(wheel!.artifact_path).toBe('py/dist');
    expect(wheel!.runs_on).toBe('ubuntu-latest');
    expect(wheel!.build).toBe('hatch');
  });

  it('setuptools still emits only an sdist row (no wheel-any)', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name  = "py-setup"
kind  = "pypi"
path  = "py"
globs = ["py/**"]
build = "setuptools"
`);

    const matrix = await plan({ cwd: CWD });
    expect(matrix.map((r) => r.target)).toEqual(['sdist']);

    // #401 short-circuit (plan.ts:305): `build === 'maturin' &&
    // isVersionIndependentWheel(...)`. For a non-maturin build the
    // left operand is false, so `isVersionIndependentWheel` must never be
    // consulted — the wheel fan is treated as version-DEPENDENT regardless
    // of what that helper would return. Asserting it was NOT called kills
    // the mutant that drops the `build === 'maturin'` guard (which would
    // consult the helper for setuptools too).
    expect(vi.mocked(isVersionIndependentWheel)).not.toHaveBeenCalled();
  });
});

describe('plan: npm bundle_cli passthrough (#298)', () => {
  it('attaches bundle_cli to per-target bundled-cli rows but NOT to the main row', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts-cli"
globs = ["packages/ts-cli/**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]

[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`);

    const matrix = await plan({ cwd: CWD });
    const perTarget = matrix.filter((r) => r.target !== 'main');
    const mainRow = matrix.find((r) => r.target === 'main');

    // Every per-target row carries bundle_cli.
    expect(perTarget.length).toBe(2);
    for (const r of perTarget) {
      expect(r.bundle_cli).toEqual({
        bin: 'my-cli',
        crate_path: 'crates/my-cli',
        features: [],
        no_default_features: false,
      });
    }

    // The noarch top-level (main) row carries no per-target binary.
    expect(mainRow).toBeDefined();
    expect(mainRow!.bundle_cli).toBeUndefined();
  });

  it('attaches bundle_cli only to bundled-cli rows in a multi-mode (napi + bundled-cli) build', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = [
  { mode = "napi",        name = "@my-cli/lib-{triple}" },
  { mode = "bundled-cli", name = "@my-cli/cli-{triple}" },
]
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`);

    const matrix = await plan({ cwd: CWD });
    const napiRow = matrix.find((r) => r.build === 'napi' && r.target !== 'main');
    const bundledRow = matrix.find((r) => r.build === 'bundled-cli' && r.target !== 'main');
    const mainRow = matrix.find((r) => r.target === 'main');

    expect(napiRow).toBeDefined();
    expect(napiRow!.bundle_cli).toBeUndefined();

    expect(bundledRow).toBeDefined();
    expect(bundledRow!.bundle_cli).toEqual({
      bin: 'my-cli',
      crate_path: 'crates/my-cli',
      features: [],
      no_default_features: false,
    });

    expect(mainRow).toBeDefined();
    expect(mainRow!.bundle_cli).toBeUndefined();
  });

  it('passes features and no_default_features through to per-target bundled-cli rows', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "."
globs = ["**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
features = ["cli"]
no_default_features = true
`);

    const matrix = await plan({ cwd: CWD });
    const perTarget = matrix.find((r) => r.target !== 'main');
    expect(perTarget?.bundle_cli).toEqual({
      bin: 'my-cli',
      crate_path: '.',
      features: ['cli'],
      no_default_features: true,
    });
  });

  it('omits bundle_cli entirely on bundled-cli rows when the package does not declare one', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "."
globs = ["**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]
`);

    const matrix = await plan({ cwd: CWD });
    for (const r of matrix) {
      expect(r.bundle_cli).toBeUndefined();
    }
  });
});

describe('plan: npm bundled-cli rust_target (#387)', () => {
  // npm `targets` are napi-rs short form (linux-x64-gnu, darwin-arm64,
  // win32-x64-msvc). The bundled-cli cross-compile feeds the triple to
  // rustup / cargo, which only understand Rust triples. plan resolves the
  // Rust triple once (via toRustTriple) and emits it as `rust_target` on
  // each bundled-cli per-target row, so the workflow reads
  // `matrix.rust_target` instead of mapping the npm-flavor triple inline.
  // Absent on the main row and on napi rows in a multi-mode package.

  // rust_target is a bundled-cli-npm-only matrix-row field; read it via the
  // same cast idiom python_version uses above, so the assertion stands
  // whether or not MatrixRow declares the field yet (red before the impl
  // adds it, green after).
  const rustTarget = (r: unknown): string | undefined =>
    (r as Record<string, unknown>)['rust_target'] as string | undefined;

  it('maps each napi-flavor target to its Rust triple on the bundled-cli rows, not the main row', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = "bundled-cli"
targets = ["linux-x64-gnu", "darwin-arm64", "win32-x64-msvc"]

[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`);

    const matrix = await plan({ cwd: CWD });

    expect(rustTarget(matrix.find((r) => r.target === 'linux-x64-gnu'))).toBe(
      'x86_64-unknown-linux-gnu',
    );
    expect(rustTarget(matrix.find((r) => r.target === 'darwin-arm64'))).toBe(
      'aarch64-apple-darwin',
    );
    expect(rustTarget(matrix.find((r) => r.target === 'win32-x64-msvc'))).toBe(
      'x86_64-pc-windows-msvc',
    );

    // The noarch top-level (main) row has no per-target binary to compile.
    expect(rustTarget(matrix.find((r) => r.target === 'main'))).toBeUndefined();
  });

  it('passes a rust-flavor target through unchanged (identity)', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`);

    const matrix = await plan({ cwd: CWD });
    expect(rustTarget(matrix.find((r) => r.target === 'x86_64-unknown-linux-gnu'))).toBe(
      'x86_64-unknown-linux-gnu',
    );
  });

  it('sets rust_target only on the bundled-cli row of a multi-mode (napi + bundled-cli) build', async () => {
    useToml(`
[putitoutthere]
version = 1

[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = [
  { mode = "napi",        name = "@my-cli/lib-{triple}" },
  { mode = "bundled-cli", name = "@my-cli/cli-{triple}" },
]
targets = ["linux-x64-gnu"]

[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`);

    const matrix = await plan({ cwd: CWD });

    // The bundled-cli row carries the mapped Rust triple…
    expect(
      rustTarget(matrix.find((r) => r.target === 'linux-x64-gnu' && r.build === 'bundled-cli')),
    ).toBe('x86_64-unknown-linux-gnu');

    // …the napi row does not — napi has its own toolchain and never
    // shells out to `rustup target add` / `cargo build --target`.
    expect(
      rustTarget(matrix.find((r) => r.target === 'linux-x64-gnu' && r.build === 'napi')),
    ).toBeUndefined();
  });
});

describe('plan: pypi multi-version wheels (#369)', () => {
  const TOML = `
[putitoutthere]
version = 1

[[package]]
name    = "py-lib"
kind    = "pypi"
path    = "pkg"
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]
globs   = ["pkg/**"]
`;

  // Cast helper: python_version is a pypi-only matrix-row field.
  const pyVer = (r: unknown): string | undefined =>
    (r as Record<string, unknown>)['python_version'] as string | undefined;

  it('fans the wheel matrix across the resolved python version set', async () => {
    useToml(`${TOML}python_versions = ["3.11", "3.12", "3.13"]\n`);
    const matrix = await plan({ cwd: CWD });
    const wheels = matrix.filter(
      (r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu',
    );
    expect(wheels.map(pyVer).sort()).toEqual(['3.11', '3.12', '3.13']);
  });

  it('suffixes wheel artifact names per python version when more than one applies', async () => {
    useToml(`${TOML}python_versions = ["3.12", "3.13"]\n`);
    const matrix = await plan({ cwd: CWD });
    const wheels = matrix.filter(
      (r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu',
    );
    expect(wheels.map((r) => r.artifact_name).sort()).toEqual([
      'py-lib-wheel-x86_64-unknown-linux-gnu-py3.12',
      'py-lib-wheel-x86_64-unknown-linux-gnu-py3.13',
    ]);
  });

  it('a python_versions override pins the wheel matrix to the subset', async () => {
    useToml(`${TOML}python_versions = ["3.10"]\n`);
    const matrix = await plan({ cwd: CWD });
    const wheels = matrix.filter(
      (r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu',
    );
    expect(wheels).toHaveLength(1);
    expect(pyVer(wheels[0]!)).toBe('3.10');
    // A single planned version keeps the historical unsuffixed name.
    expect(wheels[0]!.artifact_name).toBe('py-lib-wheel-x86_64-unknown-linux-gnu');
  });

  it('every pypi row carries a python_version, including the sdist row', async () => {
    useToml(`${TOML}python_versions = ["3.11", "3.12", "3.13"]\n`);
    const matrix = await plan({ cwd: CWD });
    const pypi = matrix.filter((r) => r.kind === 'pypi');
    expect(pypi.length).toBeGreaterThan(0);
    for (const row of pypi) {expect(typeof pyVer(row)).toBe('string');}
    const sdist = matrix.find((r) => r.kind === 'pypi' && r.target === 'sdist')!;
    expect(pyVer(sdist)).toBe('3.13');
  });

  it('falls back to a single default version when requires-python is absent', async () => {
    useToml(TOML);
    const matrix = await plan({ cwd: CWD });
    const wheels = matrix.filter(
      (r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu',
    );
    expect(wheels).toHaveLength(1);
    expect(pyVer(wheels[0]!)).toBe('3.12');
    expect(wheels[0]!.artifact_name).toBe('py-lib-wheel-x86_64-unknown-linux-gnu');
  });
});

describe('plan: version-independent maturin wheels collapse the fan (#401)', () => {
  // `isVersionIndependentWheel` is driven per case here (only its return
  // value matters to the planner): the two collapsing cases set it `true`
  // and the plain-extension case leaves the default `false`. Combined with
  // a genuine 3-version fan (via `resolvePythonVersions`), this asserts the
  // N→1 reduction, not the 1→1 no-op a single-version fixture exercises.
  const TOML = `
[putitoutthere]
version = 1

[[package]]
name    = "py-lib"
kind    = "pypi"
path    = "pkg"
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]
globs   = ["pkg/**"]
python_versions = ["3.11", "3.12", "3.13"]
`;

  const pyVer = (r: unknown): string | undefined =>
    (r as Record<string, unknown>)['python_version'] as string | undefined;
  const wheelRows = (matrix: Awaited<ReturnType<typeof plan>>): Awaited<ReturnType<typeof plan>> =>
    matrix.filter((r) => r.kind === 'pypi' && r.target === 'x86_64-unknown-linux-gnu');

  it('collapses a `bindings = "bin"` wheel to one unsuffixed row despite a 3-version fan', async () => {
    useToml(TOML);
    vi.mocked(isVersionIndependentWheel).mockResolvedValue(true);
    const wheels = wheelRows(await plan({ cwd: CWD }));
    expect(wheels).toHaveLength(1);
    expect(wheels[0]!.artifact_name).toBe('py-lib-wheel-x86_64-unknown-linux-gnu');
    expect(pyVer(wheels[0]!)).toBe('3.13');
  });

  it('collapses a pyo3 abi3 Cargo wheel to one unsuffixed row despite a 3-version fan', async () => {
    useToml(TOML);
    vi.mocked(isVersionIndependentWheel).mockResolvedValue(true);
    const wheels = wheelRows(await plan({ cwd: CWD }));
    expect(wheels).toHaveLength(1);
    expect(wheels[0]!.artifact_name).toBe('py-lib-wheel-x86_64-unknown-linux-gnu');
    expect(pyVer(wheels[0]!)).toBe('3.13');
  });

  it('keeps the full fan for a plain extension module (no abi3, no bin bindings)', async () => {
    useToml(TOML);
    // isVersionIndependentWheel defaults to false (beforeEach): no collapse.
    const wheels = wheelRows(await plan({ cwd: CWD }));
    expect(wheels.map((r) => r.artifact_name).sort()).toEqual([
      'py-lib-wheel-x86_64-unknown-linux-gnu-py3.11',
      'py-lib-wheel-x86_64-unknown-linux-gnu-py3.12',
      'py-lib-wheel-x86_64-unknown-linux-gnu-py3.13',
    ]);
  });
});

describe('plan: manual release (release-packages)', () => {
  // The motivating case: putitoutthere shipped a release bug, it was
  // fixed, and downstream consumers must re-release packages that have
  // no new commits since their last tag. Change detection emits an
  // empty matrix in that state; `release_packages` is the explicit
  // override that releases exactly the named packages anyway.

  it('releases only the named package even with no changes since its tag', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v1.2.3', 'lib-python': 'lib-python-v1.2.3' });

    const matrix = await plan({ cwd: CWD, releasePackages: 'lib-rust@minor' });
    const names = [...new Set(matrix.map((r) => r.name))];
    expect(names).toEqual(['lib-rust']);
    expect(matrix.every((r) => r.version === '1.3.0')).toBe(true);
  });

  it('bumps a bare name by patch', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v1.2.3' });

    const matrix = await plan({ cwd: CWD, releasePackages: 'lib-rust' });
    expect(matrix.every((r) => r.version === '1.2.4')).toBe(true);

    // The manual path resolves the bump via `manualVersion` (plan.ts:190),
    // the only `lastTag` caller on this path (change detection is bypassed).
    // Assert every call carries `{ cwd }` to kill the `{ cwd } -> {}` mutant.
    expect(vi.mocked(lastTag)).toHaveBeenCalled();
    for (const call of vi.mocked(lastTag).mock.calls) {
      expect(call[2]).toEqual({ cwd: CWD });
    }
  });

  it('uses an explicit version verbatim', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v1.2.3' });

    const matrix = await plan({ cwd: CWD, releasePackages: 'lib-rust@2.0.1' });
    expect(matrix.every((r) => r.version === '2.0.1')).toBe(true);
  });

  it('releases multiple named packages at their per-package versions', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v1.2.3', 'lib-python': 'lib-python-v0.4.0' });

    const matrix = await plan({
      cwd: CWD,
      releasePackages: 'lib-rust@major, lib-python@9.9.9',
    });
    expect(matrix.find((r) => r.name === 'lib-rust')!.version).toBe('2.0.0');
    expect(matrix.find((r) => r.name === 'lib-python')!.version).toBe('9.9.9');
  });

  it('ignores change-detected packages not named in the spec', async () => {
    useToml(PUTITOUTTHERE_TOML);
    setTags({ 'lib-rust': 'lib-rust-v1.2.3', 'lib-python': 'lib-python-v1.2.3' });
    // A real change to lib-python lands after the tags — but the manual
    // path bypasses change detection entirely, so it's irrelevant.
    setHeadBody('feat: python change');

    const matrix = await plan({ cwd: CWD, releasePackages: 'lib-rust@patch' });
    const names = [...new Set(matrix.map((r) => r.name))];
    expect(names).toEqual(['lib-rust']);
  });

  it('uses first_version for a named package that has no tag', async () => {
    useToml(PUTITOUTTHERE_TOML);
    // No tags: lib-rust has never been released.

    const matrix = await plan({ cwd: CWD, releasePackages: 'lib-rust@minor' });
    expect(matrix.every((r) => r.version === '0.1.0')).toBe(true);
  });

  it('throws when a named package is not declared in the config', async () => {
    useToml(PUTITOUTTHERE_TOML);

    // The manual planner rejects bad input; `plan` is async so the throw
    // surfaces as a rejection.
    await expect(plan({ cwd: CWD, releasePackages: 'lib-ghost@minor' })).rejects.toThrow(
      /lib-ghost/,
    );
  });
});
