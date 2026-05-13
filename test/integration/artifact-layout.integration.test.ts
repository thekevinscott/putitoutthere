/**
 * Single-artifact download layout normalization.
 *
 * `actions/download-artifact@v8` is count-sensitive when invoked with
 * `path:` and no `name`/`pattern` filter: a *single* artifact extracts
 * directly into the path with no `<artifact_name>/` subdir, while
 * *multiple* artifacts each get their own subdir (the layout the
 * engine's completeness check assumes; see `src/completeness.ts`).
 *
 * Consumers whose plan emits exactly one expected artifact — the
 * canonical case being a pure-Python package with `build = "hatch"`
 * (sdist row only) — therefore hit the bug: the publish job downloads
 * artifacts, gets `artifacts/<file>.tar.gz` with no subdir, and the
 * completeness check aborts with `missing artifact directory
 * <pkg>-sdist/`.
 *
 * This test plants the exact dumped-into-root layout and asserts
 * publish() recovers — i.e., gets past completeness and reaches the
 * pypi handler. Today it fails with the completeness error; after the
 * fix it succeeds.
 *
 * Issue #311.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { publish } from '../../src/publish.js';
import { makeServer, makeState, type RegistryState } from './mock-registries.js';

// Capture the real execFileSync so we can pass through git invocations
// while leaving room (if needed) to stub others. Mirrors the pattern in
// publish.integration.test.ts.
const real = vi.hoisted(() => ({
  execFileSync: undefined as unknown as typeof execFileSync,
}));

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  real.execFileSync = actual.execFileSync;
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

let state: RegistryState;
const server = (() => {
  state = makeState();
  return makeServer(state);
})();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

let repo: string;

function gitInRepo(args: string[]): void {
  real.execFileSync('git', args, { cwd: repo });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

// Single pypi package, hatch build → plan emits exactly one row
// (sdist). This is the minimal config that reproduces the v8
// single-artifact dump.
const TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "single-pkg"
kind  = "pypi"
path  = "."
globs = ["src/**", "pyproject.toml"]
build = "hatch"
`;

const PYPROJECT = `
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "single-pkg"
version = "0.0.0"
description = "fixture"
license = { text = "MIT" }
`;

beforeEach(() => {
  state.pypi.clear();
  state.crates.clear();
  state.requests.length = 0;
  state.pypiNextStatus = undefined;
  state.cratesNextStatus = undefined;

  // Pass through everything to the real binary; we don't need to stub
  // any subprocess for this test (no npm, no twine — pypi handler
  // delegates upload to the caller's pypi-publish job and returns
  // 'published' on its own).
  execMock.mockImplementation(((cmd: string, args: readonly string[], opts?: unknown) =>
    real.execFileSync(cmd, args as readonly string[], opts as Parameters<typeof execFileSync>[2]),
  ) as typeof execFileSync);

  repo = mkdtempSync(join(tmpdir(), 'piot-artlayout-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('pyproject.toml', PYPROJECT);
  writeRepoFile('src/single_pkg/__init__.py', '');
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'feat: initial\n\nrelease: 0.1.0']);

  // Pypi preflight accepts OIDC or PYPI_API_TOKEN. Use the token path
  // so the preflight finishes without an OIDC roundtrip.
  process.env.PYPI_API_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.PYPI_API_TOKEN;
  execMock.mockReset();
  server.resetHandlers();
});

describe('#311 download-artifact@v8 single-artifact layout', () => {
  it('publish() recovers when the only artifact was dumped into artifacts/ root with no subdir', async () => {
    // Plant the exact filesystem shape produced by
    // `actions/download-artifact@v8` when invoked with `path: artifacts`
    // and the upstream build job uploaded exactly one artifact:
    //
    //   artifacts/single-pkg-0.1.0.tar.gz          <-- the dump
    //
    // The documented (multi-artifact) layout the engine assumes is:
    //
    //   artifacts/single-pkg-sdist/single-pkg-0.1.0.tar.gz
    //
    // Without normalization, `checkCompleteness` walks
    // `artifacts/single-pkg-sdist/`, doesn't find it, and throws.
    const artifactsRoot = join(repo, 'artifacts');
    mkdirSync(artifactsRoot, { recursive: true });
    writeFileSync(
      join(artifactsRoot, 'single-pkg-0.1.0.tar.gz'),
      'sdist-bytes',
    );

    const result = await publish({ cwd: repo });

    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['single-pkg']);
    // pypi.org was consulted exactly once (isPublished) and returned
    // 404 → handler treated as not-yet-published and proceeded.
    expect(state.requests.filter((r) => r.url.includes('/pypi/'))).toHaveLength(1);
  });

  it('publish() leaves the documented multi-artifact layout untouched (no-op when already in subdir form)', async () => {
    // Sanity bound on the fix: a regression that *always* re-arranges
    // files would also satisfy the test above. Pin the other half:
    // when the artifact already lives in the documented subdir layout
    // (multi-artifact case, or developer running locally with the
    // engine's contract), publish() proceeds without disturbing it.
    const artifactsRoot = join(repo, 'artifacts');
    const subdir = join(artifactsRoot, 'single-pkg-sdist');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, 'single-pkg-0.1.0.tar.gz'), 'sdist-bytes');

    const result = await publish({ cwd: repo });

    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['single-pkg']);
  });
});
