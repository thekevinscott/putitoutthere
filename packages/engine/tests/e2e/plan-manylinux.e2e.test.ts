/**
 * `piot plan` manylinux baseline stamping — the e2e twin of
 * `tests/integration/pypi-manylinux.integration.test.ts` (issue #610,
 * upstream symptom thekevinscott/dirsql#818).
 *
 * Shells out to the built CLI (`node dist/cli-bin.js plan --json`)
 * against a temp repo whose maturin pypi package sets
 * `manylinux = "2_28"`. Asserts the emitted matrix rows carry the
 * baseline on linux-gnu wheel rows and nowhere else — the exact JSON
 * the reusable workflow's maturin step consumes.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

interface PlanJson {
  matrix: Array<{ target: string } & Record<string, unknown>>;
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  // Keep the run hermetic: drop $GITHUB_OUTPUT so plan's matrix= append
  // doesn't leak into the e2e job's step outputs.
  const env = { ...process.env };
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
  repo = mkdtempSync(join(tmpdir(), 'piot-manylinux-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  write(
    'putitoutthere.toml',
    `[putitoutthere]
version = 1

[[package]]
name    = "demo-py"
kind    = "pypi"
path    = "pkg"
build   = "maturin"
python_versions = ["3.12"]
manylinux = "2_28"
targets = [
  "x86_64-unknown-linux-gnu",
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" },
  "x86_64-apple-darwin",
]
globs   = ["pkg/**"]
`,
  );
  write('pkg/pyproject.toml', '[project]\nname = "demo-py"\n');
  write('pkg/lib.rs', '// rust');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('piot plan stamps the manylinux baseline (#610)', () => {
  it('emits manylinux on linux-gnu wheel rows only', () => {
    const res = runCli(['plan', '--json', '--cwd', repo]);
    expect(res.code, `plan failed:\n${res.stdout}\n${res.stderr}`).toBe(0);
    const { matrix } = JSON.parse(res.stdout) as PlanJson;

    const byTarget = (target: string) => {
      const row = matrix.find((r) => r.target === target);
      expect(row, `expected a matrix row for target ${target}`).toBeDefined();
      return row!;
    };

    expect(byTarget('x86_64-unknown-linux-gnu')['manylinux']).toBe('2_28');
    expect(byTarget('aarch64-unknown-linux-gnu')['manylinux']).toBe('2_28');
    expect(byTarget('x86_64-apple-darwin')['manylinux']).toBeUndefined();
    expect(byTarget('sdist')['manylinux']).toBeUndefined();
  });
});
