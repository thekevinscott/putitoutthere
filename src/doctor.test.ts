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
  // #189: CI runners set GITHUB_WORKFLOW_REF, which my declared-diff
  // phase reads. Clear it so tests start from a consistent state
  // regardless of where they run.
  delete process.env.GITHUB_WORKFLOW_REF;
  delete process.env.CRATES_IO_DOCTOR_TOKEN;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  delete process.env.PYPI_API_TOKEN;
  delete process.env.NODE_AUTH_TOKEN;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete process.env.CRATES_IO_DOCTOR_TOKEN;
  // #189: CI runners set GITHUB_WORKFLOW_REF. Tests that assert a green
  // declared-diff phase need a clean slate so the ref-diff doesn't
  // fire against the CI workflow name.
  delete process.env.GITHUB_WORKFLOW_REF;
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

/* ---------------- #162 Option D: trust-policy (local) ---------------- */

describe('doctor: trust-policy (local)', () => {
  const CFG = `
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
`;

  function writeWorkflow(body: string, name = 'release.yml'): void {
    mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(repo, '.github', 'workflows', name), body, 'utf8');
  }

  const GOOD = `name: Release
on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      id-token: write
    steps:
      - run: putitoutthere publish
`;

  it('all-green when the release workflow is well-formed', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(GOOD);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.trustPolicy?.workflows).toHaveLength(1);
    expect(result.trustPolicy?.workflows[0]?.permissions_ok).toBe(true);
    expect(result.trustPolicy?.workflows[0]?.environment_ok).toBe(true);
    expect(result.trustPolicy?.workflows[0]?.invocation_ok).toBe(true);
  });

  it('flags a workflow missing id-token: write', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(`jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
    steps:
      - run: putitoutthere publish
`);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toMatch(/id-token: write/);
  });

  it('flags a workflow with no `environment:` key', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(`jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - run: putitoutthere publish
`);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.issues.join('\n')).toMatch(/no `environment:` key/);
  });

  it('ignores workflows that do not invoke piot', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(`jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo nope
`, 'ci.yml');
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.trustPolicy).toBeUndefined();
  });

  it('trustPolicy is undefined when there is no .github/workflows at all', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    const result = await doctor({ cwd: repo });
    expect(result.trustPolicy).toBeUndefined();
  });

  it('flags a publish step that is commented out', async () => {
    writeCfg(CFG);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(`jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: thekevinscott/putitoutthere@v0
        with:
          command: publish
      # - run: putitoutthere publish
`);
    // Sanity: the composite-action form above keeps this workflow
    // "green" on invocation even if the commented line is ignored.
    // To exercise the "no-publish-step" path we need a workflow that
    // *only* has a commented-out publish.
    writeWorkflow(`jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      id-token: write
    steps:
      # putitoutthere publish is currently disabled:
      # - run: putitoutthere publish
      - run: echo "hello"
`, 'old-release.yml');
    const result = await doctor({ cwd: repo });
    // Should flag the old-release.yml no-publish-step issue, even
    // though the current release.yml is fine.
    expect(
      result.issues.some((i) => /no clearly-identifiable publish step/.test(i)),
    ).toBe(true);
  });
});

describe('doctor --deep', () => {
  it('flags a PyPI scope mismatch as an issue', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "ship-me"
kind  = "pypi"
path  = "packages/py"
paths = ["packages/py/**"]
`);
    process.env.PYPI_API_TOKEN = 'pypi-fake';
    mkdirSync(join(repo, 'packages/py'), { recursive: true });

    const result = await doctor({
      cwd: repo,
      deep: true,
      inspectFn: () => Promise.resolve({
        registry: 'pypi',
        source_digest: 'abc',
        format: 'macaroon',
        identifier: { user: 'u-1' },
        restrictions: [{ type: 'ProjectNames', names: ['other-pkg'] }],
        expired: false,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /scope:.+ship-me/.test(i))).toBe(true);
    const entry = result.packages.find((p) => p.name === 'ship-me');
    expect(entry?.scope_match).toBe('mismatch');
    expect(entry?.scope).toContain('other-pkg');
  });

  it('passes when scope matches the config', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "ship-me"
kind  = "pypi"
path  = "packages/py"
paths = ["packages/py/**"]
`);
    process.env.PYPI_API_TOKEN = 'pypi-fake';
    mkdirSync(join(repo, 'packages/py'), { recursive: true });

    const result = await doctor({
      cwd: repo,
      deep: true,
      inspectFn: () => Promise.resolve({
        registry: 'pypi',
        source_digest: 'abc',
        format: 'macaroon',
        identifier: { user: 'u-1' },
        restrictions: [{ type: 'ProjectNames', names: ['ship-me'] }],
        expired: false,
      }),
    });
    expect(result.ok).toBe(true);
    const entry = result.packages.find((p) => p.name === 'ship-me');
    expect(entry?.scope_match).toBe('ok');
  });

  it('skips packages without a resolvable token (auth=missing)', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "ship-me"
kind  = "pypi"
path  = "packages/py"
paths = ["packages/py/**"]
`);
    // No PYPI_API_TOKEN set. `--deep` should not call inspect at all, and
    // scope should not be populated.
    const result = await doctor({
      cwd: repo,
      deep: true,
      inspectFn: () => Promise.reject(new Error('inspect should not be called when auth is missing')),
    });
    const entry = result.packages.find((p) => p.name === 'ship-me');
    expect(entry?.scope).toBeUndefined();
  });
});

/* ---------------- #189: trust-policy (declared + crates.io) ---------------- */

describe('doctor: trust-policy (declared)', () => {
  const GOOD_WORKFLOW = `name: Release
on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      id-token: write
    steps:
      - run: putitoutthere publish
`;

  function writeWorkflow(body: string, name = 'release.yml'): void {
    mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(repo, '.github', 'workflows', name), body, 'utf8');
  }

  it('is undefined when no package declares a trust_policy', async () => {
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
    writeWorkflow(GOOD_WORKFLOW);
    const result = await doctor({ cwd: repo });
    expect(result.trustPolicyDeclared).toBeUndefined();
    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  it('all-green when declared matches the local workflow', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
[package.trust_policy]
workflow    = "release.yml"
environment = "release"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(GOOD_WORKFLOW);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.trustPolicyDeclared?.packages[0]?.workflow_ok).toBe(true);
    expect(result.trustPolicyDeclared?.packages[0]?.environment_ok).toBe(true);
    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  it('fails when declared workflow does not match the local filename', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
[package.trust_policy]
workflow = "release.yml"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(GOOD_WORKFLOW, 'patch-release.yml');
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.trustPolicyDeclared?.packages[0]?.workflow_ok).toBe(false);
    expect(result.issues.join('\n')).toMatch(/declared workflow release\.yml/);
    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  it('fails when GITHUB_WORKFLOW_REF disagrees with declared workflow', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
[package.trust_policy]
workflow = "release.yml"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    process.env.GITHUB_WORKFLOW_REF = 'octo/hello/.github/workflows/ci.yml@refs/heads/main';
    writeWorkflow(GOOD_WORKFLOW);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.trustPolicyDeclared?.packages[0]?.ref_ok).toBe(false);
    expect(result.issues.join('\n')).toMatch(/GITHUB_WORKFLOW_REF/);
    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  it('fails when declared environment does not match the workflow', async () => {
    writeCfg(`
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
[package.trust_policy]
workflow    = "release.yml"
environment = "production"
`);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    writeWorkflow(GOOD_WORKFLOW);
    const result = await doctor({ cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.trustPolicyDeclared?.packages[0]?.environment_ok).toBe(false);
    delete process.env.CARGO_REGISTRY_TOKEN;
  });
});

describe('doctor: trust-policy (crates.io registry)', () => {
  const CFG_DECLARED = `
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
[package.trust_policy]
workflow    = "release.yml"
environment = "release"
repository  = "octo/hello"
`;

  function setupWorkflow(): void {
    mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      join(repo, '.github', 'workflows', 'release.yml'),
      `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: release\n    permissions:\n      contents: write\n      id-token: write\n    steps:\n      - run: putitoutthere publish\n`,
      'utf8',
    );
  }

  it('is skipped when CRATES_IO_DOCTOR_TOKEN is unset', async () => {
    writeCfg(CFG_DECLARED);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    setupWorkflow();
    delete process.env.CRATES_IO_DOCTOR_TOKEN;
    const result = await doctor({ cwd: repo });
    expect(result.trustPolicyCratesIo?.status).toBe('skipped');
    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  it('runs and passes when the mock registry agrees with the declaration', async () => {
    writeCfg(CFG_DECLARED);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    process.env.CRATES_IO_DOCTOR_TOKEN = 'crates-tok';
    setupWorkflow();
    const result = await doctor({
      cwd: repo,
      cratesIoFetch: () =>
        Promise.resolve({
          kind: 'ok',
          configs: [
            {
              id: 1,
              repository_owner: 'octo',
              repository_name: 'hello',
              workflow_filename: 'release.yml',
              environment: 'release',
            },
          ],
        }),
    });
    expect(result.ok).toBe(true);
    expect(result.trustPolicyCratesIo?.status).toBe('ran');
    expect(result.trustPolicyCratesIo?.crates[0]?.status).toBe('ok');
    delete process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.CRATES_IO_DOCTOR_TOKEN;
  });

  it('fails when the mock registry disagrees with the declaration', async () => {
    writeCfg(CFG_DECLARED);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    process.env.CRATES_IO_DOCTOR_TOKEN = 'crates-tok';
    setupWorkflow();
    const result = await doctor({
      cwd: repo,
      cratesIoFetch: () =>
        Promise.resolve({
          kind: 'ok',
          configs: [
            {
              id: 1,
              repository_owner: 'octo',
              repository_name: 'hello',
              workflow_filename: 'patch-release.yml',
              environment: 'release',
            },
          ],
        }),
    });
    expect(result.ok).toBe(false);
    expect(result.trustPolicyCratesIo?.crates[0]?.status).toBe('mismatch');
    expect(result.issues.join('\n')).toMatch(/workflow_filename = patch-release\.yml/);
    delete process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.CRATES_IO_DOCTOR_TOKEN;
  });

  it('neutral-skips on transient fetch failure', async () => {
    writeCfg(CFG_DECLARED);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    process.env.CRATES_IO_DOCTOR_TOKEN = 'crates-tok';
    setupWorkflow();
    const result = await doctor({
      cwd: repo,
      cratesIoFetch: () =>
        Promise.resolve({ kind: 'skip-transient', reason: 'network down' }),
    });
    // Transient skip does NOT fail the overall report.
    expect(result.trustPolicyCratesIo?.crates[0]?.status).toBe('skip-transient');
    delete process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.CRATES_IO_DOCTOR_TOKEN;
  });

  it('fails on auth-failed (token rejected)', async () => {
    writeCfg(CFG_DECLARED);
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    process.env.CRATES_IO_DOCTOR_TOKEN = 'bad';
    setupWorkflow();
    const result = await doctor({
      cwd: repo,
      cratesIoFetch: () =>
        Promise.resolve({ kind: 'auth-failed', reason: 'crates.io rejected CRATES_IO_DOCTOR_TOKEN (401)' }),
    });
    expect(result.ok).toBe(false);
    expect(result.trustPolicyCratesIo?.crates[0]?.status).toBe('auth-failed');
    delete process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.CRATES_IO_DOCTOR_TOKEN;
  });
});
