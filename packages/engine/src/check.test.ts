/**
 * Unit tests for `runChecks`.
 *
 * Per AGENTS.md's test-tier split, the behavioural contract for each
 * check is *also* exercised in
 * `test/integration/check.integration.test.ts` — the tier #319's
 * acceptance criteria call out. These cases own coverage: the
 * integration config is excluded from `test:unit:coverage` per
 * `vitest.config.ts`, so every branch in `check.ts` needs a unit
 * case here even when the integration suite already covers it.
 *
 * `runChecks` isolates cleanly: its only collaborators are the
 * `node:fs` and `node:child_process` boundaries (directly in
 * `check.ts`, and transitively through the real `config` / `preflight`
 * / `glob` / `cascade` engine modules it drives). Both are automocked
 * and fed from a tiny in-memory tree so each case stages exactly the
 * manifest files the check under test reads — no throwaway git repo,
 * no real filesystem. `git ls-files` returns the tree's file list;
 * `cargo package` (the crate-size probe) is driven to "can't verify"
 * so it skips, matching how the old real-repo cases behaved without a
 * publishable crate.
 *
 * Paths are asserted separator-agnostically (never an OS-specific path
 * literal) so the suite holds on Windows, macOS, and Linux CI alike.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runChecks } from './check.js';

vi.mock('node:fs');
vi.mock('node:child_process');

/**
 * Distinctive absolute-root token. `check.ts` resolves every
 * `pkg.path` / `crate_path` against this via the real `node:path`, so
 * the mocked-fs queries all carry it exactly once — letting `rel()`
 * recover the tree-relative key regardless of the platform separator.
 */
const ROOT = '/piotroot';

/** Tree-relative posix path → file content. */
let files: Map<string, string>;
/** Tree-relative posix directory paths (`''` is the root). */
let dirs: Set<string>;

/** Recover the tree-relative posix key from an absolute fs query. */
function rel(p: unknown): string {
  const norm = String(p).replaceAll('\\', '/');
  const idx = norm.indexOf(ROOT);
  const after = idx >= 0 ? norm.slice(idx + ROOT.length) : norm;
  return after.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Register a file and every ancestor directory. */
function addFile(relPath: string, content: string): void {
  files.set(relPath, content);
  const segs = relPath.split('/');
  segs.pop();
  let acc = '';
  for (const seg of segs) {
    acc = acc === '' ? seg : `${acc}/${seg}`;
    dirs.add(acc);
  }
}

/** Stage the in-memory tree for one case. */
function build(entries: Record<string, string>): void {
  files = new Map();
  dirs = new Set(['']);
  for (const [k, v] of Object.entries(entries)) {addFile(k, v);}
}

function enoent(key: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file '${key}'`), {
    code: 'ENOENT',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  build({});

  vi.mocked(existsSync).mockImplementation((p) => {
    const key = rel(p);
    return files.has(key) || dirs.has(key);
  });

  vi.mocked(statSync).mockImplementation((p) => {
    const key = rel(p);
    const isDir = dirs.has(key) && !files.has(key);
    return { isDirectory: () => isDir } as unknown as ReturnType<typeof statSync>;
  });

  vi.mocked(readFileSync).mockImplementation((p) => {
    const key = rel(p);
    const content = files.get(key);
    if (content === undefined) {throw enoent(key);}
    return content;
  });

  // Only the workspace-member glob walk reaches this; it wants the
  // directory children of `p`, one segment deep, as Dirent-likes.
  vi.mocked(readdirSync).mockImplementation((p) => {
    const key = rel(p);
    const prefix = key === '' ? '' : `${key}/`;
    const children = new Set<string>();
    for (const d of dirs) {
      if (d === '' || !d.startsWith(prefix)) {continue;}
      const tail = d.slice(prefix.length);
      if (tail.length > 0 && !tail.includes('/')) {children.add(tail);}
    }
    return [...children].map((name) => ({
      name,
      isDirectory: () => true,
    })) as unknown as ReturnType<typeof readdirSync>;
  });

  // `checkGlobsMatchTrackedFiles` shells out to `git ls-files`; the
  // tree's file list is the tracked set.
  vi.mocked(execFileSync).mockImplementation(
    () => [...files.keys()].join('\n'),
  );

  // `checkCratesPackageSize` runs `cargo package`; a non-zero status
  // means "can't verify", so the size check skips — the same effect the
  // old cases relied on (no real publishable crate to measure).
  vi.mocked(spawnSync).mockReturnValue({
    status: 1,
    stdout: '',
    stderr: '',
    pid: 0,
    output: [],
    signal: null,
  });
});

/* ------------------------------ short-circuits ------------------------------ */

describe('runChecks: short-circuit branches', () => {
  it('returns one finding pointing at the resolved config path when the file is missing', () => {
    const findings = runChecks({ cwd: ROOT });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/putitoutthere\.toml not found/);
    // Points at the cwd-resolved config path (separator-agnostic).
    expect(findings[0]!.message).toMatch(/piotroot[/\\]putitoutthere\.toml/);
    expect(findings[0]!.package).toBeUndefined();
  });

  it('surfaces parseConfig errors and stops before downstream checks', () => {
    build({ 'putitoutthere.toml': 'this is not toml' });
    const findings = runChecks({ cwd: ROOT });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.package).toBeUndefined();
  });

  it('honors --config override', () => {
    const findings = runChecks({ cwd: ROOT, configPath: `${ROOT}/alt.toml` });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('alt.toml');
  });
});

/* ------------------------------ per-package checks ------------------------------ */

describe('runChecks: per-package checks', () => {
  it("flags a [[package]].path directory missing from the worktree", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/missing"
globs = ["packages/missing/**"]
`,
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some((f) => f.package === 'lib' && /path/.test(f.message)),
    ).toBe(true);
  });

  it("flags globs that match no tracked files", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/never-matches/**"]
`,
      'packages/ts/package.json': JSON.stringify({
        name: 'lib',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
      'packages/ts/index.ts': 'x',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some((f) => f.package === 'lib' && /glob/i.test(f.message)),
    ).toBe(true);
  });

  it("flags cyclic depends_on", () => {
    const entries: Record<string, string> = {
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "a"
kind  = "npm"
path  = "packages/a"
globs = ["packages/a/**"]
depends_on = ["b"]

[[package]]
name  = "b"
kind  = "npm"
path  = "packages/b"
globs = ["packages/b/**"]
depends_on = ["a"]
`,
    };
    for (const n of ['a', 'b']) {
      entries[`packages/${n}/package.json`] = JSON.stringify({
        name: n,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      });
      entries[`packages/${n}/index.ts`] = 'x';
    }
    build(entries);
    const findings = runChecks({ cwd: ROOT });
    expect(findings.some((f) => /cycle/i.test(f.message))).toBe(true);
  });

  it("flags two tag_format templates that collide at the same version", () => {
    const entries: Record<string, string> = {
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "a"
kind  = "npm"
path  = "packages/a"
globs = ["packages/a/**"]
tag_format = "v{version}"

[[package]]
name  = "b"
kind  = "npm"
path  = "packages/b"
globs = ["packages/b/**"]
tag_format = "v{version}"
`,
    };
    for (const n of ['a', 'b']) {
      entries[`packages/${n}/package.json`] = JSON.stringify({
        name: n,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      });
      entries[`packages/${n}/index.ts`] = 'x';
    }
    build(entries);
    const findings = runChecks({ cwd: ROOT });
    expect(findings.some((f) => /tag.*collision|collide/i.test(f.message))).toBe(true);
  });

  it("flags npm packages whose package.json is missing or has empty repository", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`,
      'packages/ts/package.json': JSON.stringify({ name: 'lib', version: '0.0.0' }),
      'packages/ts/index.ts': 'x',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) =>
          f.package === 'lib' &&
          /PIOT_NPM_MISSING_REPOSITORY/.test(f.message) &&
          /repository/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags PIOT_NPM_NAME_MISMATCH when package.json name disagrees with configured name", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "js/lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`,
      'packages/ts/package.json': JSON.stringify({
        name: 'lib',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
      'packages/ts/index.ts': 'x',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) =>
          f.package === 'js/lib' &&
          /PIOT_NPM_NAME_MISMATCH/.test(f.message),
      ),
    ).toBe(true);
  });

  it("clears PIOT_NPM_NAME_MISMATCH when the `npm` override matches package.json", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "js/lib"
kind  = "npm"
npm   = "lib"
path  = "packages/ts"
globs = ["packages/ts/**"]
`,
      'packages/ts/package.json': JSON.stringify({
        name: 'lib',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
      'packages/ts/index.ts': 'x',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(findings.some((f) => /PIOT_NPM_NAME_MISMATCH/.test(f.message))).toBe(false);
  });

  it("flags crates packages whose Cargo.toml is missing description/license", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "rust-lib"
kind  = "crates"
path  = "packages/rs"
globs = ["packages/rs/**"]
`,
      'packages/rs/Cargo.toml': `
[package]
name = "rust-lib"
version = "0.0.0"
`,
      'packages/rs/src/lib.rs': '',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) =>
          f.package === 'rust-lib' &&
          /PIOT_CRATES_MISSING_METADATA/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags pypi packages with no pyproject.toml at pkg.path", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
`,
      'packages/py/README.md': 'no pyproject',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /pyproject\.toml/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when the crate_path directory is missing", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
crate_path = "crates/missing"
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /crate_path.*does not exist/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when crate_path has no Cargo.toml", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
crate_path = "crates/cli"
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
      // Directory exists but no Cargo.toml.
      'crates/cli/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /no Cargo\.toml/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when declared bin is not a [[bin]]", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
crate_path = "crates/cli"
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
      'crates/cli/Cargo.toml': `
[package]
name = "different-name"
version = "0.0.0"

[[bin]]
name = "something-else"
path = "src/main.rs"
`,
      'crates/cli/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /my-cli/.test(f.message) && /\[\[bin\]\]/.test(f.message),
      ),
    ).toBe(true);
  });

  it("accepts an implicit-binary crate (no [[bin]] table, bin == package name)", () => {
    // Cargo's implicit-binary rule: a crate without an explicit
    // [[bin]] table ships a binary named after [package].name. The
    // common single-binary shape (one crate, one bin, no [[bin]]
    // block) must not spuriously fail.
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
crate_path = "crates/cli"
`,
      'packages/py/pyproject.toml': `
[build-system]
requires = ["maturin>=1"]
build-backend = "maturin"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.maturin]
include = ["py_lib/bin/*"]
`,
      'crates/cli/Cargo.toml': `
[package]
name = "my-cli"
version = "0.0.0"
description = "thing"
license = "MIT"
`,
      'crates/cli/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.filter((f) => f.package === 'py-lib' && /bin/.test(f.message)),
    ).toEqual([]);
  });

  it("accepts maturin+bundle_cli when crate_path has a malformed Cargo.toml (parse error)", () => {
    // Malformed TOML — the Cargo build itself will surface the parse
    // error with a real diagnostic. This check only owns the
    // [[bin]] / [package].name pair; bailing out on a parse error
    // matches `readDeclaredBins`'s skip-silently semantics so a
    // typo'd Cargo.toml doesn't produce a misleading "bin not
    // declared" finding.
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
crate_path = "crates/cli"
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
      // Cargo.toml exists but is malformed. readDeclaredBins returns []
      // and the "declared bins: (none)" branch lands.
      'crates/cli/Cargo.toml': 'not = "valid toml" [[[',
      'crates/cli/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) =>
          f.package === 'py-lib' &&
          /my-cli/.test(f.message) &&
          /\(none\)/.test(f.message),
      ),
    ).toBe(true);
  });

  it("accepts maturin+bundle_cli when the bin lives in a workspace member crate (crate_path is the workspace root)", () => {
    // Cargo-workspace layout (this is `thekevinscott/dirsql`'s shape):
    // - `/Cargo.toml`      = `[workspace]` table, no `[[bin]]`
    // - `/crates/cli/Cargo.toml` = `[package]` with `[[bin]] my-cli`
    //
    // `cargo build --bin my-cli` from the workspace root resolves the
    // bin transparently. The check must do the same — walking the
    // workspace's `members` and aggregating each member's `[[bin]]`
    // entries — otherwise `crate_path = "."` (the default) is
    // unsatisfiable for the standard cargo-workspace shape: any value
    // that makes the check pass breaks the build's stage step (which
    // reads from `<crate_path>/target/...`, but cargo writes to the
    // workspace-rooted target dir).
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
# crate_path defaults to "." (the workspace root).
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
      // Workspace root Cargo.toml — no [package], no [[bin]].
      'Cargo.toml': `
[workspace]
members = ["crates/cli"]
resolver = "2"
`,
      // Member crate carries the [[bin]].
      'crates/cli/Cargo.toml': `
[package]
name = "cli-crate"
version = "0.0.0"
description = "thing"
license = "MIT"

[[bin]]
name = "my-cli"
path = "src/main.rs"
`,
      'crates/cli/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.filter(
        (f) => f.package === 'py-lib' && /\[\[bin\]\]/.test(f.message),
      ),
    ).toEqual([]);
  });

  it("walks past a workspace member entry whose Cargo.toml is missing", () => {
    // Defensive path in the workspace walk: cargo's `members` array can
    // point at glob patterns or stale entries that don't resolve to a
    // real manifest. The check silently skips those (cargo's own
    // diagnostics own surfacing them) and still resolves bins from the
    // members that do exist.
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
      'Cargo.toml': `
[workspace]
members = ["crates/missing", "crates/cli"]
resolver = "2"
`,
      // Only the second member exists. The first ("crates/missing")
      // points at a path with no Cargo.toml — parseCargoToml returns
      // null and the walk continues to the next member.
      'crates/cli/Cargo.toml': `
[package]
name = "cli-crate"
version = "0.0.0"
description = "thing"
license = "MIT"

[[bin]]
name = "my-cli"
path = "src/main.rs"
`,
      'crates/cli/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.filter(
        (f) => f.package === 'py-lib' && /\[\[bin\]\]/.test(f.message),
      ),
    ).toEqual([]);
  });

  it("accepts maturin+bundle_cli when [workspace].members is a glob and the bin lives in a matched member crate", () => {
    // #361: cargo `[workspace].members` entries are globs, and
    // `members = ["packages/*"]` is the standard polyglot-repo shape —
    // a Rust core crate under `packages/rust`, wrapped by sibling
    // python/npm packages. #337 taught the bundle_cli check to walk
    // *literal* member entries, but a glob entry never resolves to a
    // literal `<member>/Cargo.toml`: the walk reads
    // `packages/*/Cargo.toml`, finds nothing, and reports the bin as
    // missing. The check must expand member globs the same way cargo
    // does, otherwise `crate_path = "."` (the default) is unsatisfiable
    // for any workspace that declares its members with a glob.
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin       = "my-cli"
stage_to  = "py_lib/bin"
# crate_path defaults to "." (the workspace root).
`,
      'packages/py/pyproject.toml': `
[project]
name = "py-lib"
dynamic = ["version"]
`,
      // Workspace root Cargo.toml — members declared with a glob.
      'Cargo.toml': `
[workspace]
members = ["packages/*"]
resolver = "2"
`,
      // Member crate (matched by the glob) carries the [[bin]].
      'packages/rust/Cargo.toml': `
[package]
name = "rust-core"
version = "0.0.0"
description = "thing"
license = "MIT"

[[bin]]
name = "my-cli"
path = "src/main.rs"
`,
      'packages/rust/src/main.rs': 'fn main(){}',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.filter(
        (f) => f.package === 'py-lib' && /\[\[bin\]\]/.test(f.message),
      ),
    ).toEqual([]);
  });

  it("flags npm targets containing a triple that's not in TRIPLE_MAP", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
build = "napi"
targets = ["totally-made-up-triple"]
`,
      'packages/ts/package.json': JSON.stringify({
        name: 'lib',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
      'packages/ts/index.ts': 'x',
    });
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) => f.package === 'lib' && /totally-made-up-triple/.test(f.message),
      ),
    ).toBe(true);
  });
});

/* ------------------------------ happy path ------------------------------ */

describe('runChecks: well-formed config', () => {
  it("returns zero findings when every check passes", () => {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "lib-js"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]

[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "packages/rs"
globs = ["packages/rs/**"]

[[package]]
name  = "lib-py"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
`,
      'packages/ts/package.json': JSON.stringify({
        name: 'lib-js',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }),
      'packages/ts/index.ts': 'x',
      'packages/rs/Cargo.toml': `
[package]
name = "lib-rs"
version = "0.0.0"
description = "thing"
license = "MIT"
`,
      'packages/rs/src/lib.rs': '',
      'packages/py/pyproject.toml': `
[build-system]
requires = ["setuptools>=64", "setuptools-scm>=8"]
build-backend = "setuptools.build_meta"

[project]
name = "lib-py"
dynamic = ["version"]

[tool.setuptools_scm]
`,
      'packages/py/lib_py/__init__.py': '',
    });
    expect(runChecks({ cwd: ROOT })).toEqual([]);
  });
});

describe('runChecks: repository URL match against GITHUB_REPOSITORY', () => {
  function buildOneNpmPkg(repositoryUrl: string): void {
    build({
      'putitoutthere.toml': `
[putitoutthere]
version = 1

[[package]]
name  = "lib-js"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`,
      'packages/ts/package.json': JSON.stringify({
        name: 'lib-js',
        version: '0.0.0',
        repository: { type: 'git', url: repositoryUrl },
      }),
      'packages/ts/index.ts': 'x',
    });
  }

  it('passes when GITHUB_REPOSITORY matches the manifest URL', () => {
    buildOneNpmPkg('git+https://github.com/acme/widget.git');
    process.env.GITHUB_REPOSITORY = 'acme/widget';
    expect(runChecks({ cwd: ROOT })).toEqual([]);
  });

  it('flags PIOT_REPO_URL_MISMATCH when GITHUB_REPOSITORY disagrees with the manifest URL', () => {
    buildOneNpmPkg('git+https://github.com/wrong/repo.git');
    process.env.GITHUB_REPOSITORY = 'acme/widget';
    const findings = runChecks({ cwd: ROOT });
    expect(
      findings.some(
        (f) => f.package === 'lib-js' && f.message.includes('PIOT_REPO_URL_MISMATCH'),
      ),
    ).toBe(true);
  });

  it('skips the URL-match check when GITHUB_REPOSITORY is unset (local CLI run)', () => {
    buildOneNpmPkg('git+https://github.com/wrong/repo.git');
    // setup.ts already deletes GITHUB_REPOSITORY; assert no PIOT_REPO_URL_MISMATCH.
    const findings = runChecks({ cwd: ROOT });
    expect(findings.some((f) => f.message.includes('PIOT_REPO_URL_MISMATCH'))).toBe(false);
  });
});
