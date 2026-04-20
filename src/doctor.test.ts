/**
 * `putitoutthere doctor` tests. Validates config + auth, reports to
 * stdout as a table, exits 0 on clean / 1 on problems.
 *
 * Issue #23. Plan: §21.1, §16.4.7.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { doctor } from './doctor.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'doctor-test-'));
  mkdirSync(join(repo, 'packages/rust'), { recursive: true });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  delete process.env.PYPI_API_TOKEN;
  delete process.env.NODE_AUTH_TOKEN;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
});

function writeCfg(body: string): void {
  writeFileSync(join(repo, 'putitoutthere.toml'), body, 'utf8');
}

describe('doctor', () => {
  it('reports ok when config parses and every package has auth', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags missing config', async () => {
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/config|toml/i);
  });

  it('flags malformed config', async () => {
    writeCfg('this is not valid toml =  =');
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/toml|parse/i);
  });

  it('flags missing auth per package', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
paths = ["**"]
[[package]]
name  = "b"
kind  = "pypi"
path  = "b"
paths = ["**"]
`);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    const joined = result.issues.join(' ');
    expect(joined).toMatch(/CARGO_REGISTRY_TOKEN/);
    expect(joined).toMatch(/PYPI_API_TOKEN/);
  });

  it('accepts OIDC when ACTIONS_ID_TOKEN_REQUEST_TOKEN is set', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
paths = ["**"]
`);
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'x';
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(true);
  });

  it('reports a summary line with package counts', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
paths = ["**"]
[[package]]
name  = "b"
kind  = "npm"
path  = "b"
paths = ["**"]
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    process.env.NODE_AUTH_TOKEN = 'tok';
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.packages).toHaveLength(2);
  });
});

/* --------------------- #89: artifact completeness --------------------- */

function initGit(at: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: at });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: at });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: at });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: at });
  execFileSync('git', ['add', '-A'], { cwd: at });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: at });
}

describe('doctor: checkArtifacts', () => {
  const CFG = `
[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`;

  it('reports a missing artifact directory with the expected layout', async () => {
    mkdirSync(join(repo, 'rust'), { recursive: true });
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit(repo);

    const result = await doctor({ cwd: repo, checkArtifacts: true });
    expect(result.ok).toBe(false);
    expect(result.artifacts).toEqual([
      {
        package: 'lib-rs',
        target: 'noarch',
        artifact_name: 'lib-rs-crate',
        present: false,
        expected: 'artifacts/lib-rs-crate/lib-rs-0.1.0.crate',
      },
    ]);
    expect(result.issues.join('\n')).toMatch(
      /artifacts: lib-rs.*expected artifacts\/lib-rs-crate\/lib-rs-0\.1\.0\.crate/,
    );
  });

  it('reports ok when every expected artifact dir is staged', async () => {
    mkdirSync(join(repo, 'rust'), { recursive: true });
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    initGit(repo);
    mkdirSync(join(repo, 'artifacts', 'lib-rs-crate'), { recursive: true });

    const result = await doctor({ cwd: repo, checkArtifacts: true });
    expect(result.ok).toBe(true);
    expect(result.artifacts?.[0]?.present).toBe(true);
  });

  it('reports a soft issue when plan cannot run (no git state)', async () => {
    mkdirSync(join(repo, 'rust'), { recursive: true });
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    // no git init → plan throws on headCommit

    const result = await doctor({ cwd: repo, checkArtifacts: true });
    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toMatch(/artifacts: cannot walk plan/);
  });

  it('skips npm-vanilla rows (publishes from source tree, no artifact dir)', async () => {
    mkdirSync(join(repo, 'js'), { recursive: true });
    writeFileSync(join(repo, 'js/package.json'), '{}', 'utf8');
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
    initGit(repo);

    const result = await doctor({ cwd: repo, checkArtifacts: true });
    expect(result.ok).toBe(true);
    expect(result.artifacts).toEqual([]);
  });

  it('checkArtifacts off → artifacts field is undefined', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    const result = await doctor({ cwd: repo });
    expect(result.artifacts).toBeUndefined();
  });
});
