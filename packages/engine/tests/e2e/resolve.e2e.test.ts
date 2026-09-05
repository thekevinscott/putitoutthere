/**
 * `putitoutthere resolve` against the built CLI — the e2e twin of
 * `tests/integration/resolve.integration.test.ts` (#683,
 * thekevinscott/willfire#152).
 *
 * Shells out to `node dist/cli-bin.js resolve --cwd …` from this repo's
 * own checkout and asserts the same contract the integration twin pins:
 * one JSON map on stdout keyed `<owner>/<repo>/<workflow-path>:<job-id>`
 * (format frozen on thekevinscott/willfire#153), one entry per fixture
 * enumerable from the checkout, `outputs` carrying the exact strings the
 * live plan job's `$GITHUB_OUTPUT` would. Everything is local and
 * deterministic: fixture sources on disk, throwaway git repos in tmp, no
 * network.
 *
 * The js-vanilla `matrix` expectation is pinned byte-exact against
 * `JSON.stringify` of the real `plan()` matrix over the materialized
 * fixture (`__VERSION__` → 0.0.0) — the same bytes `emitPlanOutputs`
 * writes after `matrix=` into `$GITHUB_OUTPUT`. The one deliberate
 * divergence from a live run is the version: the live plan job stamps a
 * run-scoped `0.0.{unix_seconds}` no static resolver can reproduce, and
 * `resolve` pins 0.0.0 so its output is deterministic.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'packages', 'engine', 'tests', 'fixtures');
const KEY = 'thekevinscott/putitoutthere/.github/workflows/e2e-fixture-job.yml:plan';

// Captured $GITHUB_OUTPUT bytes from `plan` over the materialized fixture.
const JS_VANILLA_MATRIX =
  '[{"name":"@putitoutthere/piot-fixture-zzz-js-vanilla","kind":"npm","version":"0.0.0",'
  + '"target":"noarch","runs_on":"ubuntu-latest",'
  + '"artifact_name":"@putitoutthere__piot-fixture-zzz-js-vanilla-pkg",'
  + '"artifact_path":"package.json","path":"."}]';

interface CallbackEntry {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

function fixturesOnDisk(): string[] {
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function runResolve(cwd: string): { code: number; stdout: string; stderr: string } {
  // Keep the run hermetic: drop $GITHUB_OUTPUT so the delegated plan runs
  // can't append to the e2e job's step outputs.
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  try {
    const stdout = execFileSync('node', [CLI, 'resolve', '--cwd', cwd], {
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

describe('putitoutthere resolve — the full map from this checkout', () => {
  let first: { code: number; stdout: string; stderr: string };
  let second: { code: number; stdout: string; stderr: string };
  let map: Record<string, CallbackEntry[]>;

  beforeAll(() => {
    first = runResolve(REPO_ROOT);
    second = runResolve(REPO_ROOT);
    map = JSON.parse(first.stdout) as Record<string, CallbackEntry[]>;
  }, 240_000);

  it('exits 0 with exactly one JSON line on stdout', () => {
    expect(first.code).toBe(0);
    expect(first.stdout.endsWith('\n')).toBe(true);
    expect(first.stdout.slice(0, -1)).not.toContain('\n');
  });

  it('carries exactly the frozen #153 key', () => {
    expect(Object.keys(map)).toEqual([KEY]);
  });

  it('enumerates one entry per fixture directory, sorted, keyed by the fixture input alone', () => {
    const entries = map[KEY]!;
    expect(entries.map((e) => e.inputs)).toEqual(
      fixturesOnDisk().map((fixture) => ({ fixture })),
    );
  });

  it('answers js-vanilla with the exact $GITHUB_OUTPUT matrix bytes and a truthful has_pypi', () => {
    const entry = map[KEY]!.find((e) => e.inputs.fixture === 'js-vanilla')!;
    expect(entry.outputs).toEqual({ matrix: JS_VANILLA_MATRIX, has_pypi: 'false' });
  });

  it('answers python-pure-hatch with pypi rows and has_pypi "true"', () => {
    const entry = map[KEY]!.find((e) => e.inputs.fixture === 'python-pure-hatch')!;
    expect(entry.outputs.has_pypi).toBe('true');
    const rows = JSON.parse(entry.outputs.matrix!) as { kind: string; version: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.kind).toBe('pypi');
      expect(row.version).toBe('0.0.0');
    }
  });

  it('resolves every declared fixture to a non-empty matrix whose has_pypi matches its rows', () => {
    for (const entry of map[KEY]!) {
      const rows = JSON.parse(entry.outputs.matrix!) as { kind: string }[];
      expect(rows.length).toBeGreaterThan(0);
      const expected = rows.some((row) => row.kind === 'pypi') ? 'true' : 'false';
      expect(entry.outputs.has_pypi).toBe(expected);
    }
  });

  it('is byte-identical across invocations', () => {
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });
});

describe('putitoutthere resolve — other checkouts', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints {} for a checkout that does not define the e2e fixture workflow', () => {
    dir = mkdtempSync(join(tmpdir(), 'piot-resolve-e2e-other-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const result = runResolve(dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('{}\n');
  });

  it('fails closed when the workflow exists but the fixtures root is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'piot-resolve-e2e-broken-'));
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'e2e-fixture-job.yml'), 'on: workflow_call\n');
    const result = runResolve(dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    const lines = result.stderr.split('\n').filter((l) => l !== '');
    expect(lines.at(-1)).toBe(
      'putitoutthere: resolve: fixtures root missing at packages/engine/tests/fixtures',
    );
  });
});
