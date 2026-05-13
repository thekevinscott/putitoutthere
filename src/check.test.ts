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
 * Each case stands up a throwaway git repo (cheap — needed because
 * `checkGlobsMatchTrackedFiles` shells out to `git ls-files`) and
 * drives `runChecks` against a hand-built `putitoutthere.toml` plus
 * exactly the manifest files the check under test reads.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChecks } from './check.js';

let cwd: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(rel: string, body: string): void {
  const full = join(cwd, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function initRepo(): void {
  cwd = mkdtempSync(join(tmpdir(), 'piot-check-unit-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  git(['config', 'commit.gpgsign', 'false']);
}

function commit(message = 'snapshot'): void {
  git(['add', '-A']);
  git(['commit', '-q', '-m', message]);
}

beforeEach(() => {
  initRepo();
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/* ------------------------------ short-circuits ------------------------------ */

describe('runChecks: short-circuit branches', () => {
  it('returns one finding pointing at the resolved config path when the file is missing', () => {
    const findings = runChecks({ cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/putitoutthere\.toml not found/);
    expect(findings[0]!.message).toContain(cwd);
    expect(findings[0]!.package).toBeUndefined();
  });

  it('surfaces parseConfig errors and stops before downstream checks', () => {
    write('putitoutthere.toml', 'this is not toml');
    const findings = runChecks({ cwd });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.package).toBeUndefined();
  });

  it('honors --config override', () => {
    const altPath = join(cwd, 'alt.toml');
    const findings = runChecks({ cwd, configPath: altPath });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('alt.toml');
  });
});

/* ------------------------------ per-package checks ------------------------------ */

describe('runChecks: per-package checks', () => {
  it("flags a [[package]].path directory missing from the worktree", () => {
    write('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/missing"
globs = ["packages/missing/**"]
`);
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some((f) => f.package === 'lib' && /path/.test(f.message)),
    ).toBe(true);
  });

  it("flags globs that match no tracked files", () => {
    write('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/never-matches/**"]
`);
    write('packages/ts/package.json', JSON.stringify({
      name: 'lib',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    write('packages/ts/index.ts', 'x');
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some((f) => f.package === 'lib' && /glob/i.test(f.message)),
    ).toBe(true);
  });

  it("flags cyclic depends_on", () => {
    write('putitoutthere.toml', `
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
`);
    for (const n of ['a', 'b']) {
      write(`packages/${n}/package.json`, JSON.stringify({
        name: n,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }));
      write(`packages/${n}/index.ts`, 'x');
    }
    commit();
    const findings = runChecks({ cwd });
    expect(findings.some((f) => /cycle/i.test(f.message))).toBe(true);
  });

  it("flags two tag_format templates that collide at the same version", () => {
    write('putitoutthere.toml', `
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
`);
    for (const n of ['a', 'b']) {
      write(`packages/${n}/package.json`, JSON.stringify({
        name: n,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }));
      write(`packages/${n}/index.ts`, 'x');
    }
    commit();
    const findings = runChecks({ cwd });
    expect(findings.some((f) => /tag.*collision|collide/i.test(f.message))).toBe(true);
  });

  it("flags npm packages whose package.json is missing or has empty repository", () => {
    write('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`);
    write('packages/ts/package.json', JSON.stringify({ name: 'lib', version: '0.0.0' }));
    write('packages/ts/index.ts', 'x');
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some(
        (f) =>
          f.package === 'lib' &&
          /PIOT_NPM_MISSING_REPOSITORY/.test(f.message) &&
          /repository/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags crates packages whose Cargo.toml is missing description/license", () => {
    write('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "rust-lib"
kind  = "crates"
path  = "packages/rs"
globs = ["packages/rs/**"]
`);
    write('packages/rs/Cargo.toml', `
[package]
name = "rust-lib"
version = "0.0.0"
`);
    write('packages/rs/src/lib.rs', '');
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some(
        (f) =>
          f.package === 'rust-lib' &&
          /PIOT_CRATES_MISSING_METADATA/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags pypi packages with no pyproject.toml at pkg.path", () => {
    write('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
`);
    write('packages/py/README.md', 'no pyproject');
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /pyproject\.toml/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when the crate_path directory is missing", () => {
    write('putitoutthere.toml', `
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
`);
    write('packages/py/pyproject.toml', `
[project]
name = "py-lib"
dynamic = ["version"]
`);
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /crate_path.*does not exist/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when crate_path has no Cargo.toml", () => {
    write('putitoutthere.toml', `
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
`);
    write('packages/py/pyproject.toml', `
[project]
name = "py-lib"
dynamic = ["version"]
`);
    // Directory exists but no Cargo.toml.
    write('crates/cli/src/main.rs', 'fn main(){}');
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /no Cargo\.toml/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when declared bin is not a [[bin]]", () => {
    write('putitoutthere.toml', `
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
`);
    write('packages/py/pyproject.toml', `
[project]
name = "py-lib"
dynamic = ["version"]
`);
    write('crates/cli/Cargo.toml', `
[package]
name = "different-name"
version = "0.0.0"

[[bin]]
name = "something-else"
path = "src/main.rs"
`);
    write('crates/cli/src/main.rs', 'fn main(){}');
    commit();
    const findings = runChecks({ cwd });
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
    write('putitoutthere.toml', `
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
`);
    write('packages/py/pyproject.toml', `
[project]
name = "py-lib"
dynamic = ["version"]
`);
    write('crates/cli/Cargo.toml', `
[package]
name = "my-cli"
version = "0.0.0"
description = "thing"
license = "MIT"
`);
    write('crates/cli/src/main.rs', 'fn main(){}');
    commit();
    const findings = runChecks({ cwd });
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
    write('putitoutthere.toml', `
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
`);
    write('packages/py/pyproject.toml', `
[project]
name = "py-lib"
dynamic = ["version"]
`);
    // Cargo.toml exists but is malformed. readDeclaredBins returns []
    // and the "declared bins: (none)" branch lands.
    write('crates/cli/Cargo.toml', 'not = "valid toml" [[[');
    write('crates/cli/src/main.rs', 'fn main(){}');
    commit();
    const findings = runChecks({ cwd });
    expect(
      findings.some(
        (f) =>
          f.package === 'py-lib' &&
          /my-cli/.test(f.message) &&
          /\(none\)/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags npm targets containing a triple that's not in TRIPLE_MAP", () => {
    write('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
build = "napi"
targets = ["totally-made-up-triple"]
`);
    write('packages/ts/package.json', JSON.stringify({
      name: 'lib',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    write('packages/ts/index.ts', 'x');
    commit();
    const findings = runChecks({ cwd });
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
    write('putitoutthere.toml', `
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
`);
    write('packages/ts/package.json', JSON.stringify({
      name: 'lib-js',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    write('packages/ts/index.ts', 'x');
    write('packages/rs/Cargo.toml', `
[package]
name = "lib-rs"
version = "0.0.0"
description = "thing"
license = "MIT"
`);
    write('packages/rs/src/lib.rs', '');
    write('packages/py/pyproject.toml', `
[project]
name = "lib-py"
dynamic = ["version"]
`);
    write('packages/py/lib_py/__init__.py', '');
    commit();
    expect(runChecks({ cwd })).toEqual([]);
  });
});
