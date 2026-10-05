/**
 * `runChecks` must reject a `dynamic = ["version"]` whose version source no
 * release step can reach (#696): `dynamic` satisfies the static-literal
 * check and `[tool.hatch.version]` satisfies the no-backend check, yet plain
 * hatchling ignores `SETUPTOOLS_SCM_PRETEND_VERSION` and nothing rewrites it.
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

function commitAll(): void {
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'snapshot']);
}

/** Config for one pypi package at `packages/py`, with the given build mode. */
function config(build: string, extra = ''): string {
  return `
[putitoutthere]
version = 1

[[package]]
name  = "py-lib"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "${build}"
${extra}
`;
}

/** Only the findings this issue's contract is about. */
function versionSourceFindings(
  findings: readonly { package?: string; message: string }[],
): string[] {
  return findings
    .filter((f) =>
      /PIOT_PYPI_HATCH_VERSION_PATH|PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND/.test(f.message),
    )
    .map((f) => `${f.package ?? '(file)'}: ${f.message}`);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-check-pyver-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('runChecks: the declared dynamic version must resolve to a reachable source (#696)', () => {
  it('flags hatchling\'s file-path version source, which no release step rewrites', async () => {
    // Verbatim the shape that published 0.0.0 to PyPI while the plan
    // said 0.1.0. `dynamic` is declared and `[tool.hatch.version]`
    // exists, so both existing gates pass.
    writeRepoFile('putitoutthere.toml', config('hatch'));
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.hatch.version]
path = "py_lib/_version.py"
`);
    writeRepoFile('packages/py/py_lib/__init__.py', '');
    writeRepoFile('packages/py/py_lib/_version.py', '__version__ = "0.0.0"\n');
    commitAll();

    const findings = await runChecks({ cwd: repo });
    const hit = findings.find(
      (f) => f.package === 'py-lib' && /PIOT_PYPI_HATCH_VERSION_PATH/.test(f.message),
    );
    expect(hit, `findings were: ${JSON.stringify(findings, null, 2)}`).toBeDefined();
    // The message must name the offending file and the fix, because the
    // fix here ("switch the source") differs from the no-plugin case
    // ("add the plugin").
    expect(hit?.message).toContain('py_lib/_version.py');
    expect(hit?.message).toMatch(/source\s*=\s*"vcs"/);
  });

  it('flags source = "code" too — it also reads a literal off disk', async () => {
    // hatchling's non-`vcs` sources are all path-driven: `regex` (the
    // default, implied by a bare `path`) reads the literal, `code`
    // imports the file and reads a symbol. Neither sees
    // SETUPTOOLS_SCM_PRETEND_VERSION, so both ship whatever is committed.
    writeRepoFile('putitoutthere.toml', config('hatch'));
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.hatch.version]
source = "code"
path = "py_lib/_version.py"
expression = "__version__"
`);
    writeRepoFile('packages/py/py_lib/__init__.py', '');
    commitAll();

    const findings = await runChecks({ cwd: repo });
    expect(
      findings.some(
        (f) => f.package === 'py-lib' && /PIOT_PYPI_HATCH_VERSION_PATH/.test(f.message),
      ),
      `findings were: ${JSON.stringify(findings, null, 2)}`,
    ).toBe(true);
  });

  it('flags source = "vcs" when hatch-vcs is missing from [build-system].requires', async () => {
    // `source = "vcs"` is hatch-vcs's plugin entry point. Without the
    // plugin installed hatchling fails with "Unknown version source:
    // vcs" — mid-build, after the release has already started.
    writeRepoFile('putitoutthere.toml', config('hatch'));
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
`);
    writeRepoFile('packages/py/py_lib/__init__.py', '');
    commitAll();

    const findings = await runChecks({ cwd: repo });
    const hit = findings.find(
      (f) => f.package === 'py-lib' && /PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND/.test(f.message),
    );
    expect(hit, `findings were: ${JSON.stringify(findings, null, 2)}`).toBeDefined();
    expect(hit?.message).toContain('hatch-vcs');
  });

  it('flags [tool.setuptools_scm] when setuptools-scm is missing from [build-system].requires', async () => {
    writeRepoFile('putitoutthere.toml', config('setuptools'));
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.setuptools_scm]
`);
    writeRepoFile('packages/py/py_lib/__init__.py', '');
    commitAll();

    const findings = await runChecks({ cwd: repo });
    const hit = findings.find(
      (f) => f.package === 'py-lib' && /PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND/.test(f.message),
    );
    expect(hit, `findings were: ${JSON.stringify(findings, null, 2)}`).toBeDefined();
    expect(hit?.message).toContain('setuptools-scm');
  });

  it('accepts hatch-vcs: source = "vcs" declared with the plugin in requires', async () => {
    // The other half of the contract. Without these green pins an
    // always-flags regression would satisfy every red test above.
    writeRepoFile('putitoutthere.toml', config('hatch'));
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling", "hatch-vcs>=0.4"]
build-backend = "hatchling.build"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
`);
    writeRepoFile('packages/py/py_lib/__init__.py', '');
    commitAll();

    expect(versionSourceFindings(await runChecks({ cwd: repo }))).toEqual([]);
  });

  it('accepts setuptools-scm spelled with an underscore and a version specifier', async () => {
    // PyPI normalises `_`/`-`/`.` runs in distribution names, so
    // `setuptools_scm>=8` is the same requirement as `setuptools-scm`.
    // A naive substring match on the requires list would reject it.
    writeRepoFile('putitoutthere.toml', config('setuptools'));
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["setuptools>=61", "setuptools_scm>=8"]
build-backend = "setuptools.build_meta"

[project]
name = "py-lib"
dynamic = ["version"]

[tool.setuptools_scm]
`);
    writeRepoFile('packages/py/py_lib/__init__.py', '');
    commitAll();

    expect(versionSourceFindings(await runChecks({ cwd: repo }))).toEqual([]);
  });

  it('accepts a maturin package with no version block — Cargo.toml is the source piot bumps', async () => {
    writeRepoFile(
      'putitoutthere.toml',
      config('maturin', 'targets = ["x86_64-unknown-linux-gnu"]'),
    );
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["maturin>=1"]
build-backend = "maturin"

[project]
name = "py-lib"
dynamic = ["version"]
`);
    writeRepoFile('packages/py/Cargo.toml', `
[package]
name = "py-lib"
version = "0.1.0"
description = "thing"
license = "MIT"
`);
    writeRepoFile('packages/py/src/lib.rs', '');
    commitAll();

    expect(versionSourceFindings(await runChecks({ cwd: repo }))).toEqual([]);
  });
});
