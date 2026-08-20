/**
 * Delegated PyPI publishes must not be tagged by the publish job (#623)
 * — against the real CLI and the real registry. The e2e twin of
 * `tests/integration/pypi-delegated-tag.integration.test.ts`.
 *
 * Where the integration test mocks PyPI's HTTP read, this shells out to
 * the built CLI (`node dist/cli-bin.js publish`) and lets it hit
 * pypi.org for real, pointed at the live, piot-owned fixture project
 * `piot-fixture-zzz-python-sdist` at a version that will never exist.
 * The real 404 is what makes the run take the delegation path, and no
 * upload happens on that path by construction — the whole point of #623
 * is that the engine hands the upload to a caller-side job — so this
 * publishes nothing anywhere.
 *
 * The contract: the run succeeds, says the upload was delegated, and
 * leaves NO git tag behind. The tag is the record of what shipped, and
 * nothing has shipped until the caller-side `pypi-publish` job uploads.
 *
 * Red before the fix: the delegation path reports `published` and the
 * tag is cut here.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issue #623.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const PROJECT = 'piot-fixture-zzz-python-sdist';
// Far past anything the fixture will ever publish, so pypi.org answers
// the handler's `isPublished` GET with a genuine 404.
const VERSION = '999.999.999';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  // A throwaway value clears the auth pre-flight (never used — the
  // delegation path uploads nothing). Deliberately low-entropy: a
  // `piot-e2e-*-placeholder` string clears generic-api-key's 3.5 entropy
  // threshold and trips the secret scan (see `.gitleaksignore`). Drop the
  // GitHub vars so the repo-visibility / URL-match pre-flights no-op.
  const env = { ...process.env, PYPI_API_TOKEN: 'not-a-token' };
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;
  delete env.GITHUB_OUTPUT;
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

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-pypi-delegated-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  writeRepoFile(
    'putitoutthere.toml',
    `[putitoutthere]
version = 1

[[package]]
name  = "fixture-py"
kind  = "pypi"
pypi  = "${PROJECT}"
build = "setuptools"
path  = "packages/py"
globs = ["packages/py/**"]
`,
  );
  // Minimal manifest so the pypi pre-flights (name match, backend match,
  // dynamic version source) pass. No build backend is ever invoked.
  writeRepoFile(
    'packages/py/pyproject.toml',
    `[project]
name = "${PROJECT}"
dynamic = ["version"]
requires-python = ">=3.12"

[build-system]
requires = ["setuptools", "setuptools-scm"]
build-backend = "setuptools.build_meta"

[tool.setuptools_scm]
`,
  );
  writeRepoFile('packages/py/src/fixture_py/__init__.py', '');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);

  // A `setuptools` pypi package plans exactly one row (sdist); stage its
  // artifact so the completeness check passes. Nothing reads the bytes.
  writeRepoFile(`artifacts/fixture-py-sdist/${PROJECT}-${VERSION}.tar.gz`, 'sdist');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('delegated PyPI publish against pypi.org (#623)', () => {
  it('delegates the upload and cuts no tag', () => {
    const { code, stdout, stderr } = runCli([
      'publish', '--release-packages', `fixture-py@${VERSION}`, '--cwd', repo,
    ]);
    const output = `${stdout}\n${stderr}`;

    expect(code, output).toBe(0);
    // The engine says out loud that it handed the upload off...
    expect(output).toContain('delegated');
    // ...and left the tag for whoever performs the upload. A tag here
    // would claim a version that is not on PyPI and never will be.
    expect(git(['tag', '-l']), output).toBe('');
  });
});
