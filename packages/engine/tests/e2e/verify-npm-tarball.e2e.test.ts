/**
 * `piot verify npm-tarball` against the REAL npm registry — the e2e twin
 * of `tests/integration/verify-npm-tarball.integration.test.ts`.
 *
 * Shells out to the built CLI (`node dist/cli-bin.js verify npm-tarball …`)
 * pointed at piot's own stable, OIDC-published fixture package
 * `@putitoutthere/piot-fixture-zzz-js-vanilla`, whose `package.json`
 * declares `files: ["dist"]` and whose published tarball ships a real
 * `dist/`. This is the tier that proves the real `npm view` → `curl` →
 * `tar` pipeline actually downloads and inspects a live tarball — a mock
 * that returns the shape we assumed cannot.
 *
 * The `--per-triple` case (#633) needs a live platform tarball whose payload
 * sits NESTED under `package/`, and no `piot-fixture-zzz-*` package ships one
 * — piot's own synthesis has only ever staged flat, which is why the bug went
 * unnoticed. `@esbuild/linux-x64` is the stand-in: a real, version-pinned
 * (hence byte-immutable) published platform package whose binary lives at
 * `package/bin/esbuild`, exactly the layout the issue describes. `npm view` →
 * `curl` → `tar` run for real against it.
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

// `verifyNpmTarballTriple` reconstructs the platform package name as
// `{name}-{triple}` (the default synthesis template), so the row splits
// `@esbuild/linux-x64` at the last dash. Pinned to a version that predates
// this test and is depended on by `esbuild` itself, so it can neither change
// nor be unpublished.
const NESTED_BASE = '@esbuild/linux';
const NESTED_TRIPLE = 'x64';
const NESTED_VERSION = '0.25.0';

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

  it('counts a nested payload in a live per-triple tarball (#633)', () => {
    // `@esbuild/linux-x64`'s tarball is `package/package.json`,
    // `package/README.md`, and the binary one level down at
    // `package/bin/esbuild`. Counting only top-level FILES sees the README
    // and stops there — it never counts the binary, which is the whole point
    // of the check. The listing must name the nested path.
    const matrix = JSON.stringify([
      {
        name: NESTED_BASE,
        kind: 'npm',
        version: NESTED_VERSION,
        target: NESTED_TRIPLE,
        path: 'packages/npm',
      },
    ]);

    const { code, stdout, stderr } = runCli([
      'verify', 'npm-tarball', '--per-triple',
      '--registry', 'https://registry.npmjs.org',
      '--matrix', matrix, '--cwd', repo,
    ]);

    expect(stdout, `output:\n${stdout}\n${stderr}`).toContain('bin/esbuild');
    expect(code).toBe(0);
  });
});
