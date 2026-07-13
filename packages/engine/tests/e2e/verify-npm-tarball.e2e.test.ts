/**
 * `piot verify npm-tarball` against the REAL npm registry — the e2e twin
 * of `test/integration/verify-npm-tarball.integration.test.ts`.
 *
 * Shells out to the built CLI (`node dist/cli-bin.js verify npm-tarball …`)
 * pointed at piot's own stable, OIDC-published fixture package
 * `@putitoutthere/piot-fixture-zzz-js-vanilla`, whose `package.json`
 * declares `files: ["dist"]` and whose published tarball ships a real
 * `dist/`. This is the tier that proves the real `npm view` → `curl` →
 * `tar` pipeline actually downloads and inspects a live tarball — a mock
 * that returns the shape we assumed cannot.
 *
 * Red before the feature: `verify npm-tarball` is an unrecognized
 * subcommand, so no `ok: package/dist/` line is emitted.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Epic #442, #443.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const PKG = '@putitoutthere/piot-fixture-zzz-js-vanilla';

let repo: string;

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
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

function latestVersion(): string {
  return execFileSync('npm', ['view', PKG, 'version'], { encoding: 'utf8' }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-npmtar-e2e-'));
  mkdirSync(join(repo, 'packages/npm'), { recursive: true });
  writeFileSync(
    join(repo, 'packages/npm/package.json'),
    JSON.stringify({ name: PKG, version: '0.0.0', files: ['dist'] }),
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('piot verify npm-tarball against the live npm registry (#443)', () => {
  it('confirms the published tarball honors package.json files[]', () => {
    const version = latestVersion();
    const matrix = JSON.stringify([
      { name: PKG, kind: 'npm', version, target: 'main', path: 'packages/npm' },
    ]);

    const { code, stdout, stderr } = runCli([
      'verify', 'npm-tarball', '--matrix', matrix, '--cwd', repo,
    ]);

    expect(stdout, `output:\n${stdout}\n${stderr}`).toContain('ok: package/dist/');
    expect(code).toBe(0);
  });
});
