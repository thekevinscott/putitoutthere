/**
 * `runChecks` pre-merge validation — integration test.
 *
 * Per the "No release surprises" goal in `notes/design-commitments.md`
 * (after #316) and issue #319: every check knowable from the consumer's
 * repo state alone runs at PR time, before a release run could fail
 * mid-publish on a precondition checkable in milliseconds.
 *
 * Lives in `test/integration/` because the bug class this exists to
 * prevent — a misconfigured `putitoutthere.toml` shipping a real
 * release — is only observable when the real config loader, the real
 * cascade graph, the real `git ls-files` walk, and the real per-kind
 * manifest readers all run together. Unit tests with mock handlers
 * cannot observe that integration.
 *
 * Each test seeds a clean git repo with exactly the misconfiguration
 * under test plus the well-formed pieces it needs to reach that check,
 * then asserts the corresponding finding lands in `runChecks(...)`'s
 * output. The closing "well-formed config passes" test pins the other
 * half of the contract so an always-fails regression can't satisfy
 * the red set.
 *
 * Issue #319.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChecks } from '../../src/check.js';

let repo: string;

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function initRepo(): void {
  repo = mkdtempSync(join(tmpdir(), 'piot-check-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
}

function commitAll(message = 'snapshot'): void {
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', message]);
}

beforeEach(() => {
  initRepo();
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/* ------------------------------ config-sanity ------------------------------ */

describe('runChecks: config sanity (#319)', () => {
  it('flags a missing putitoutthere.toml', () => {
    // No config file written at all. Most common adopter mistake.
    const findings = runChecks({ cwd: repo });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /putitoutthere\.toml.*not found/i.test(f.message))).toBe(true);
  });

  it('surfaces zod / friendly-hint errors from parseConfig', () => {
    // `[[packages]]` (plural) — detectCommonMistakes catches this.
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[packages]]
name  = "lib"
kind  = "npm"
path  = "pkg"
globs = ["pkg/**"]
`);
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(findings.length).toBeGreaterThan(0);
    expect(
      findings.some((f) => /\[\[package\]\]/.test(f.message) && /\[\[packages\]\]/.test(f.message)),
    ).toBe(true);
  });

  it("flags packages whose `path` directory does not exist in the worktree", () => {
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/missing"
globs = ["packages/missing/**"]
`);
    // No packages/missing/ directory created.
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) => f.package === 'lib' && /path/i.test(f.message) && /packages\/missing/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags packages whose globs match no tracked files", () => {
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/never-matches/**"]
`);
    writeRepoFile('packages/ts/package.json', JSON.stringify({
      name: 'lib',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    writeRepoFile('packages/ts/index.ts', 'x');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) =>
          f.package === 'lib' &&
          /glob/i.test(f.message) &&
          /tracked|match|cascade/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags cyclic depends_on", () => {
    writeRepoFile('putitoutthere.toml', `
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
      writeRepoFile(`packages/${n}/package.json`, JSON.stringify({
        name: n,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }));
      writeRepoFile(`packages/${n}/index.ts`, 'x');
    }
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(findings.some((f) => /cycle/i.test(f.message))).toBe(true);
  });

  it("flags dangling depends_on names", () => {
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "a"
kind  = "npm"
path  = "packages/a"
globs = ["packages/a/**"]
depends_on = ["does-not-exist"]
`);
    writeRepoFile('packages/a/package.json', JSON.stringify({
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    writeRepoFile('packages/a/index.ts', 'x');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(findings.some((f) => /unknown depends_on|does-not-exist/i.test(f.message))).toBe(true);
  });

  it("flags packages whose tag_format resolves to the same tag", () => {
    // Two packages with `tag_format = "v{version}"` would race for one
    // `v0.0.0` tag at the same version. Detectable from templates alone.
    writeRepoFile('putitoutthere.toml', `
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
      writeRepoFile(`packages/${n}/package.json`, JSON.stringify({
        name: n,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      }));
      writeRepoFile(`packages/${n}/index.ts`, 'x');
    }
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(findings.some((f) => /tag.*collision|collide/i.test(f.message))).toBe(true);
  });
});

/* ------------------------------ per-kind manifest ------------------------------ */

describe('runChecks: per-kind manifest checks (#319)', () => {
  it("flags npm packages whose package.json has no repository field", () => {
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "lib"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`);
    writeRepoFile('packages/ts/package.json', JSON.stringify({ name: 'lib', version: '0.0.0' }));
    writeRepoFile('packages/ts/index.ts', 'x');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) => f.package === 'lib' && /PIOT_NPM_MISSING_REPOSITORY|repository/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags crates packages whose Cargo.toml is missing description / license", () => {
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "rust-lib"
kind  = "crates"
path  = "packages/rs"
globs = ["packages/rs/**"]
`);
    writeRepoFile('packages/rs/Cargo.toml', `
[package]
name = "rust-lib"
version = "0.0.0"
`);
    writeRepoFile('packages/rs/src/lib.rs', '');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) =>
          f.package === 'rust-lib' &&
          /PIOT_CRATES_MISSING_METADATA|description|license/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags pypi packages missing pyproject.toml at pkg.path", () => {
    writeRepoFile('putitoutthere.toml', `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
`);
    writeRepoFile('packages/py/README.md', 'no pyproject');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /pyproject\.toml/.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags maturin+bundle_cli when crate_path's Cargo.toml has no matching [[bin]]", () => {
    writeRepoFile('putitoutthere.toml', `
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
    writeRepoFile('packages/py/pyproject.toml', `
[project]
name = "py-lib"
version = "0.0.0"
`);
    // Cargo.toml exists but declares a different binary name.
    writeRepoFile('crates/cli/Cargo.toml', `
[package]
name = "different-name"
version = "0.0.0"

[[bin]]
name = "something-else"
path = "src/main.rs"
`);
    writeRepoFile('crates/cli/src/main.rs', 'fn main(){}');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) =>
          f.package === 'py-lib' &&
          /my-cli/.test(f.message) &&
          /\[\[bin\]\]|bin/i.test(f.message),
      ),
    ).toBe(true);
  });

  it("flags npm `targets` triples that are not in the runner-mapping table", () => {
    writeRepoFile('putitoutthere.toml', `
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
    writeRepoFile('packages/ts/package.json', JSON.stringify({
      name: 'lib',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    writeRepoFile('packages/ts/index.ts', 'x');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) =>
          f.package === 'lib' &&
          /totally-made-up-triple/.test(f.message) &&
          /TRIPLE_MAP|not mapped/i.test(f.message),
      ),
    ).toBe(true);
  });
});

/* ------------------------------ happy path ------------------------------ */

describe('runChecks: well-formed config passes', () => {
  it("returns zero findings for a fully-correct polyglot config", () => {
    // Pins the other half of the contract: an always-throws regression
    // would also satisfy every red test above. This makes the green
    // state observable.
    writeRepoFile('putitoutthere.toml', `
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
    writeRepoFile('packages/ts/package.json', JSON.stringify({
      name: 'lib-js',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }));
    writeRepoFile('packages/ts/index.ts', 'x');
    writeRepoFile('packages/rs/Cargo.toml', `
[package]
name = "lib-rs"
version = "0.0.0"
description = "thing"
license = "MIT"
`);
    writeRepoFile('packages/rs/src/lib.rs', '');
    writeRepoFile('packages/py/pyproject.toml', `
[project]
name = "lib-py"
version = "0.0.0"
`);
    writeRepoFile('packages/py/lib_py/__init__.py', '');
    commitAll();
    const findings = runChecks({ cwd: repo });
    expect(findings).toEqual([]);
  });
});
