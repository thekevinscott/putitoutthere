/**
 * `putitoutthere resolve` — willfire's callback map for the e2e plan job
 * (#683, thekevinscott/willfire#152).
 *
 * putitoutthere's own PR CI fans `e2e-fixture.yml` over
 * `e2e-fixture-job.yml`, whose `plan` job needs installed dependencies —
 * the one job willfire's sandbox cannot execute. `resolve` answers it
 * ahead of predict time: one JSON map on stdout, keyed
 * `<owner>/<repo>/<workflow-path>:<job-id>` (format frozen on
 * thekevinscott/willfire#153), one entry per fixture enumerable from the
 * checkout, `outputs` carrying the exact strings the live job's
 * `$GITHUB_OUTPUT` would — matched per invocation by inputs subset.
 *
 * Mocks nothing. The map's entire claim is agreement with what the live
 * plan job computes from the same fixture sources; a mocked plan would
 * only prove self-consistency. Everything is local and deterministic:
 * fixture sources on disk, throwaway git repos in tmp, no network.
 *
 * The js-vanilla `matrix` expectation is pinned byte-exact against
 * `JSON.stringify` of the real `plan()` matrix over the materialized
 * fixture (`__VERSION__` → 0.0.0) — the same bytes `emitPlanOutputs`
 * writes after `matrix=` into `$GITHUB_OUTPUT`. The one deliberate
 * divergence from a live run is the version: the live plan job stamps a
 * run-scoped `0.0.{unix_seconds}` no static resolver can reproduce, and
 * `resolve` pins 0.0.0 so its output is deterministic.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

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

async function runResolve(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const code = await run(['node', 'putitoutthere', 'resolve', '--cwd', cwd]);
  vi.restoreAllMocks();
  return { code, stdout, stderr };
}

describe('putitoutthere resolve — the full map from this checkout', () => {
  let first: { code: number; stdout: string; stderr: string };
  let second: { code: number; stdout: string; stderr: string };
  let map: Record<string, CallbackEntry[]>;

  beforeAll(async () => {
    first = await runResolve(REPO_ROOT);
    second = await runResolve(REPO_ROOT);
    map = JSON.parse(first.stdout) as Record<string, CallbackEntry[]>;
  }, 240_000);

  it('exits 0 with exactly one JSON line on stdout and nothing on stderr', () => {
    expect(first.code).toBe(0);
    expect(first.stderr).toBe('');
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

  it('prints {} for a checkout that does not define the e2e fixture workflow', async () => {
    dir = mkdtempSync(join(tmpdir(), 'piot-resolve-other-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const result = await runResolve(dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('{}\n');
  });

  it('fails closed when the workflow exists but the fixtures root is missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'piot-resolve-broken-'));
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'e2e-fixture-job.yml'), 'on: workflow_call\n');
    const result = await runResolve(dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    const lines = result.stderr.split('\n').filter((l) => l !== '');
    expect(lines.at(-1)).toBe(
      'putitoutthere: resolve: fixtures root missing at packages/engine/tests/fixtures',
    );
  });
});
