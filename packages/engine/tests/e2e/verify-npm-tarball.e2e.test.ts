/**
 * `verify npm-tarball` against the REAL npm registry. Epic #442, #443.
 * The `--per-triple` case (#633) needs a live platform tarball with its
 * payload NESTED under `package/`, and no `piot-fixture-zzz-*` ships one:
 * `@esbuild/linux-x64` is version-pinned (byte-immutable) and nests.
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

// #716: the path segment a scoped name occupies on the registry — `@` stays
// literal, `/` stays percent-encoded.
const PKG_PATH = encodeURIComponent(PKG).replaceAll('%40', '@');
// The fixture's real versions are epoch-derived (`0.0.<unix-seconds>`), so a
// prerelease spelling can never collide with one and stays absent forever.
const ABSENT_VERSION = '0.0.0-never-published';

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

  it('answers an absent version from the immutable per-version document, with no propagation wait (#716)', () => {
    // Against live npm this is the whole of #716. Resolving off the MUTABLE
    // packument cannot tell "never published" from "published but not
    // propagated", so the old path burned a 5m20s budget and then guessed in
    // prose; three successful publishes in two days landed 46s / 103s / 110s
    // on the wrong side of it. `GET /<name>/<version>` is written at publish
    // time, so its 404 is a verdict available on the first read.
    const matrix = JSON.stringify([
      { name: PKG, kind: 'npm', version: ABSENT_VERSION, target: 'main', path: 'packages/npm' },
    ]);

    const started = Date.now();
    const { code, stdout, stderr } = runCli([
      'verify', 'npm-tarball', '--matrix', matrix, '--cwd', repo,
    ]);
    const elapsedMs = Date.now() - started;

    const text = `${stdout}${stderr}`;
    expect(text, `output:\n${text}`).toContain(
      `https://registry.npmjs.org/${PKG_PATH}/${ABSENT_VERSION}`,
    );
    expect(text).toContain('404');
    expect(code).toBe(1);
    // The duration is the assertion the issue asked for, inverted: there is
    // no propagation budget left to outlast, so a wrong endpoint choice (or a
    // reintroduced "retry until it appears" ladder) shows up here as minutes.
    expect(elapsedMs, `elapsed ${elapsedMs}ms`).toBeLessThan(30_000);
  });
});
