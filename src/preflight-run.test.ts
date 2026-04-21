/**
 * `runPreflight` tests. Exercises the orchestrator end-to-end against a
 * temp fixture repo: config + plan + path + manifest + auth + repository
 * + artifact checks.
 *
 * Issue #93.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runPreflight } from './preflight-run.js';

let repo: string;

function writeCfg(body: string): void {
  writeFileSync(join(repo, 'putitoutthere.toml'), body, 'utf8');
}

function writeFile(relative: string, content: string): void {
  const full = join(repo, relative);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function initGit(): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'preflight-run-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  delete process.env.PYPI_API_TOKEN;
  delete process.env.NODE_AUTH_TOKEN;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
});

describe('runPreflight: happy path', () => {
  it('reports ok when every check passes for a cascaded npm package', async () => {
    writeFile(
      'packages/js/package.json',
      JSON.stringify({ name: 'lib-js', version: '0.0.0', repository: { type: 'git', url: 'x' } }),
    );
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-js"
kind  = "npm"
path  = "packages/js"
paths = ["packages/js/**"]
first_version = "0.1.0"
`);
    process.env.NODE_AUTH_TOKEN = 'tok';
    initGit();
    mkdirSync(join(repo, 'artifacts/lib-js-pkg'), { recursive: true });

    const report = await runPreflight({ cwd: repo });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    const names = report.checks.map((c) => `${c.check}:${c.status}`).sort();
    expect(names).toEqual([
      'auth:ok',
      'manifest:ok',
      'path:ok',
      'repository:ok',
    ]);
    // npm-noarch has no artifact dir to check.
  });

  it('includes artifact check for crates packages', async () => {
    writeFile('rust/Cargo.toml', '[package]\nname = "lib-rs"\nversion = "0.0.0"\n');
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit();
    mkdirSync(join(repo, 'artifacts/lib-rs-crate'), { recursive: true });

    const report = await runPreflight({ cwd: repo });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.check === 'artifact')?.status).toBe('ok');
  });
});

describe('runPreflight: failure surfaces', () => {
  it('fails when pkg.path does not exist', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "ghost"
kind  = "crates"
path  = "does-not-exist"
paths = ["**"]
first_version = "0.1.0"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit();
    const report = await runPreflight({ cwd: repo, all: true });
    const pathCheck = report.checks.find((c) => c.check === 'path');
    expect(pathCheck?.status).toBe('fail');
    expect(pathCheck?.detail).toMatch(/does not exist/);
    expect(report.ok).toBe(false);
  });

  it('fails when manifest is missing under pkg.path', async () => {
    mkdirSync(join(repo, 'rust'));
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit();
    const report = await runPreflight({ cwd: repo, all: true });
    const manifest = report.checks.find((c) => c.check === 'manifest');
    expect(manifest?.status).toBe('fail');
    expect(manifest?.detail).toMatch(/Cargo\.toml/);
  });

  it('fails when auth env var and OIDC are both missing', async () => {
    writeFile('rust/Cargo.toml', '[package]\nname = "lib-rs"\nversion = "0.0.0"\n');
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`);
    initGit();
    const report = await runPreflight({ cwd: repo, all: true });
    const auth = report.checks.find((c) => c.check === 'auth');
    expect(auth?.status).toBe('fail');
    expect(auth?.detail).toMatch(/CARGO_REGISTRY_TOKEN/);
  });

  it('fails npm repository check when package.json lacks `repository`', async () => {
    writeFile('js/package.json', JSON.stringify({ name: 'lib-js', version: '0.0.0' }));
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-js"
kind  = "npm"
path  = "js"
paths = ["js/**"]
first_version = "0.1.0"
`);
    process.env.NODE_AUTH_TOKEN = 'tok';
    initGit();
    const report = await runPreflight({ cwd: repo, all: true });
    const repo_ = report.checks.find((c) => c.check === 'repository');
    expect(repo_?.status).toBe('fail');
    expect(repo_?.detail).toMatch(/repository/);
  });

  it('skips npm repository check when package.json is missing', async () => {
    mkdirSync(join(repo, 'js'));
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-js"
kind  = "npm"
path  = "js"
paths = ["js/**"]
first_version = "0.1.0"
`);
    process.env.NODE_AUTH_TOKEN = 'tok';
    initGit();
    const report = await runPreflight({ cwd: repo, all: true });
    const repo_ = report.checks.find((c) => c.check === 'repository');
    expect(repo_?.status).toBe('skip');
  });

  it('fails npm repository check when package.json is malformed JSON', async () => {
    writeFile('js/package.json', '{ not valid json');
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-js"
kind  = "npm"
path  = "js"
paths = ["js/**"]
first_version = "0.1.0"
`);
    process.env.NODE_AUTH_TOKEN = 'tok';
    initGit();
    const report = await runPreflight({ cwd: repo, all: true });
    const repo_ = report.checks.find((c) => c.check === 'repository');
    expect(repo_?.status).toBe('fail');
    expect(repo_?.detail).toMatch(/parse/);
  });

  it('fails artifact check when expected dir is missing for a cascaded crates row', async () => {
    writeFile('rust/Cargo.toml', '[package]\nname = "lib-rs"\nversion = "0.0.0"\n');
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit();
    // no artifacts/ dir staged
    const report = await runPreflight({ cwd: repo });
    const artifact = report.checks.find((c) => c.check === 'artifact');
    expect(artifact?.status).toBe('fail');
    expect(artifact?.detail).toMatch(/expected artifacts\/lib-rs-crate\/lib-rs-0\.1\.0\.crate/);
  });
});

describe('runPreflight: top-level failures', () => {
  it('short-circuits with a config issue when the file is missing', async () => {
    const report = await runPreflight({ cwd: repo });
    expect(report.ok).toBe(false);
    expect(report.issues.join('\n')).toMatch(/config/);
    expect(report.checks).toEqual([]);
  });

  it('records a plan issue but continues when there is no git state', async () => {
    writeFile('rust/Cargo.toml', '[package]\nname = "lib-rs"\nversion = "0.0.0"\n');
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    // no git init → plan throws

    const report = await runPreflight({ cwd: repo, all: true });
    expect(report.issues.join('\n')).toMatch(/plan: cannot compute matrix/);
    // Per-package checks still run against config.
    expect(report.checks.filter((c) => c.package === 'lib-rs').length).toBeGreaterThan(0);
  });
});

describe('runPreflight: scope (--all)', () => {
  // A config with two packages where only one changed since HEAD.
  // Default scope should filter down to the cascaded package; --all
  // widens it.
  it('default scope excludes non-cascaded packages', async () => {
    writeFile('a/Cargo.toml', '[package]\nname = "a"\nversion = "0.0.0"\n');
    writeFile('b/Cargo.toml', '[package]\nname = "b"\nversion = "0.0.0"\n');
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
paths = ["a/**"]
first_version = "0.1.0"
[[package]]
name  = "b"
kind  = "crates"
path  = "b"
paths = ["b/**"]
first_version = "0.1.0"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit();
    // First-release cascades everything; both `a` and `b` are in the plan.
    const defaultReport = await runPreflight({ cwd: repo });
    expect(
      defaultReport.checks.filter((c) => c.check === 'path').map((c) => c.package).sort(),
    ).toEqual(['a', 'b']);

    // Tag both packages so the next plan cascades nothing. --all forces
    // all configured packages into scope.
    execFileSync('git', ['tag', 'a-v0.1.0'], { cwd: repo });
    execFileSync('git', ['tag', 'b-v0.1.0'], { cwd: repo });

    const narrowReport = await runPreflight({ cwd: repo });
    expect(narrowReport.checks.filter((c) => c.check === 'path')).toEqual([]);

    const allReport = await runPreflight({ cwd: repo, all: true });
    expect(
      allReport.checks.filter((c) => c.check === 'path').map((c) => c.package).sort(),
    ).toEqual(['a', 'b']);
  });
});
