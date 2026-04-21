/**
 * Spawn-based regression test for pkg.path absolutization (issue #88,
 * follow-up to #85).
 *
 * The in-process test in `src/publish.test.ts` asserts that publish()
 * absolutizes pkg.path before calling handlers. That catches TS-level
 * regressions but not:
 *   - breakage in how `bin/putitoutthere` parses `--cwd`, or
 *   - a handler that re-introduces relative-path access from
 *     process.cwd() (fs reads, execFileSync cwd, etc).
 *
 * This test spawns the real CLI from a working directory that is
 * deliberately NOT the fixture repo, then runs `publish --dry-run` with
 * `--cwd <repo>`. If any part of the chain (CLI arg parsing, config
 * loader, plan, preflight) forgets to anchor filesystem access to
 * `--cwd`, this fails with a non-zero exit.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeE2ERepo, type E2ERepo } from './harness.js';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

let repo: E2ERepo;
let spawnCwd: string;

beforeEach(() => {
  repo = makeE2ERepo({ fixture: 'e2e-canary' });
  // A fresh tmp dir with no putitoutthere.toml, no package.json, no .git.
  // If the CLI reads from process.cwd() anywhere it shouldn't, this will
  // produce either an "ENOENT" or a silently-empty plan.
  spawnCwd = mkdtempSync(join(tmpdir(), 'piot-spawn-'));
});

afterEach(() => {
  rmSync(repo.cwd, { recursive: true, force: true });
  rmSync(spawnCwd, { recursive: true, force: true });
});

describe('e2e: pkg.path absolutization (spawn surface)', () => {
  it('publish --dry-run succeeds when spawn cwd != --cwd', () => {
    const out = execFileSync(
      'node',
      [CLI, 'publish', '--dry-run', '--json', '--cwd', repo.cwd],
      {
        cwd: spawnCwd,
        env: {
          ...process.env,
          NODE_AUTH_TOKEN: 'e2e-dry-run-placeholder',
          PYPI_API_TOKEN: 'e2e-dry-run-placeholder',
          CARGO_REGISTRY_TOKEN: 'e2e-dry-run-placeholder',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const result = JSON.parse(out.trim()) as {
      ok: boolean;
      published: Array<{ package: string; version: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package).sort()).toEqual([
      'piot-fixture-zzz-cli',
      'piot-fixture-zzz-python',
      'piot-fixture-zzz-rust',
    ]);
    for (const entry of result.published) {
      expect(entry.version).toBe(repo.version);
    }
  });

  it('plan --json succeeds when spawn cwd != --cwd', () => {
    const out = execFileSync('node', [CLI, 'plan', '--json', '--cwd', repo.cwd], {
      cwd: spawnCwd,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const matrix = JSON.parse(out.trim()) as Array<{ name: string; version: string }>;
    expect(matrix.map((r) => r.name).sort()).toEqual([
      'piot-fixture-zzz-cli',
      'piot-fixture-zzz-python',
      'piot-fixture-zzz-rust',
    ]);
    for (const row of matrix) {
      expect(row.version).toBe(repo.version);
    }
  });
});
