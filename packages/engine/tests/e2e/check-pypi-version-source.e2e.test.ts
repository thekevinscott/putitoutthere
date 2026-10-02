/**
 * `check` must reject a `dynamic = ["version"]` whose version source no
 * release step can reach: plain hatchling reads `[tool.hatch.version] path`
 * and ignores `SETUPTOOLS_SCM_PRETEND_VERSION`, the only version handoff the
 * reusable workflow has. #696.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  // `check` compares declared repository URLs against GITHUB_REPOSITORY
  // when it is set; the throwaway repo declares none, so drop it to keep
  // the run hermetic whether or not the suite runs inside Actions.
  delete env.GITHUB_REPOSITORY;
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function checkJson(): { code: number; messages: string[]; raw: string } {
  const { code, stdout, stderr } = runCli(['check', '--cwd', repo, '--json']);
  const parsed = JSON.parse(stdout) as { findings: { package?: string; message: string }[] };
  return {
    code,
    messages: parsed.findings.map((f) => `${f.package ?? '(file)'}: ${f.message}`),
    raw: stdout + stderr,
  };
}

const PYPI_PACKAGE_CONFIG = `[putitoutthere]
version = 1

[[package]]
name  = "piot-e2e-pyver"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
build = "hatch"
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-check-pyver-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeRepoFile('putitoutthere.toml', PYPI_PACKAGE_CONFIG);
  writeRepoFile('packages/py/piot_e2e_pyver/__init__.py', '');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('putitoutthere check: unreachable pypi dynamic version source (#696)', () => {
  it('exits non-zero on hatchling\'s file-path version source', () => {
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "piot-e2e-pyver"
dynamic = ["version"]

[tool.hatch.version]
path = "piot_e2e_pyver/_version.py"
`);
    writeRepoFile('packages/py/piot_e2e_pyver/_version.py', '__version__ = "0.0.0"\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'snapshot']);

    const { code, messages, raw } = checkJson();
    expect(
      messages.some((m) => /piot-e2e-pyver/.test(m) && /PIOT_PYPI_HATCH_VERSION_PATH/.test(m)),
      `CLI output was: ${raw}`,
    ).toBe(true);
    expect(messages.some((m) => /piot_e2e_pyver\/_version\.py/.test(m))).toBe(true);
    expect(code).toBe(1);
  });

  it('exits non-zero when source = "vcs" but hatch-vcs is not in [build-system].requires', () => {
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "piot-e2e-pyver"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
`);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'snapshot']);

    const { code, messages, raw } = checkJson();
    expect(
      messages.some(
        (m) => /PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND/.test(m) && /hatch-vcs/.test(m),
      ),
      `CLI output was: ${raw}`,
    ).toBe(true);
    expect(code).toBe(1);
  });

  it('exits zero on the blessed hatch-vcs shape', () => {
    // Pins the other half: an always-flags regression would satisfy the
    // red tests above but break every correctly-configured consumer.
    writeRepoFile('packages/py/pyproject.toml', `
[build-system]
requires = ["hatchling", "hatch-vcs"]
build-backend = "hatchling.build"

[project]
name = "piot-e2e-pyver"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
`);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'snapshot']);

    const { code, stdout } = runCli(['check', '--cwd', repo]);
    expect(stdout).toContain('check: no findings');
    expect(code).toBe(0);
  });
});
