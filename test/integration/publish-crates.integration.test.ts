/**
 * `publish` pipeline integration test for the crates preflight.
 *
 * Sibling to `publish.integration.test.ts` (#280's npm `repository`
 * preflight); this file covers #290 — the same shape for crates.io's
 * required `[package].description` and `[package].license` /
 * `[package].license-file` Cargo.toml metadata.
 *
 * The bug: cargo publish refuses with
 *   `400 Bad Request: missing or empty metadata fields: description.`
 * after `cargo publish`'s verification build has compiled the crate
 * and every transitive dep — wasting the entire publish job on a
 * precondition checkable in milliseconds. Same wasted-work argument
 * as #280; same fix shape (preflight that refuses before any side
 * effect).
 *
 * Real config loader, real plan, real preflight, real handler
 * dispatch. Mocked seams:
 *   - `cargo` subprocess (recorded; should never be invoked when
 *     preflight rejects).
 *   - crates.io HTTP via msw (only relevant for the sanity-check
 *     test where preflight passes and `isPublished` is reached).
 *
 * Issue #290.
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

const real = vi.hoisted(() => ({ execFileSync: undefined as unknown as typeof execFileSync }));

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

const TOML = `
[putitoutthere]
version = 1

[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "packages/rust"
globs = ["packages/rust/**"]
`;

// Cargo.toml deliberately missing description + license. Override per-test
// where the well-formed shape is needed.
const CARGO_TOML_MISSING_METADATA = `[package]
name = "lib-rs"
version = "0.0.0"
edition = "2021"
`;

const CARGO_TOML_WELL_FORMED = `[package]
name = "lib-rs"
version = "0.0.0"
edition = "2021"
description = "A test crate."
license = "MIT"
`;

beforeEach(() => {
  state.crates.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;

  repo = mkdtempSync(join(tmpdir(), 'piot-publish-crates-int-'));

  // Single dispatcher: cargo invocations would be the bug-surface side
  // effect; intercept and never invoke the real cargo. Everything else
  // (git in particular) hits the real binary so plan()'s `git log` /
  // `git rev-parse` work against the real repo.
  execMock.mockImplementation(((cmd: string, args: readonly string[], opts?: unknown) => {
    if (cmd === 'cargo') {
      // Record-only; if the test asserts cargo was *not* invoked, this
      // body never executes. If it does run (sanity-check test),
      // pretend the publish succeeded so the handler's downstream path
      // doesn't crash the test on an unexpected stderr shape.
      return Buffer.from('');
    }
    return real.execFileSync(
      cmd,
      args as readonly string[],
      opts as Parameters<typeof execFileSync>[2],
    );
  }) as typeof execFileSync);

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('packages/rust/src/lib.rs', '');
  writeRepoFile('packages/rust/Cargo.toml', CARGO_TOML_MISSING_METADATA);
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  // Auth: set a token so the auth preflight passes; the missing
  // metadata is the only thing left to fail on.
  process.env.CARGO_REGISTRY_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  execMock.mockReset();
  server.resetHandlers();
});

describe('publish: crates preflight rejects missing Cargo.toml metadata (#290)', () => {
  it('aborts at preflight when a crates Cargo.toml lacks `description`', async () => {
    // Cargo.toml from beforeEach is missing both description and license.
    // The bug #290 describes is exactly this: putitoutthere should refuse
    // before invoking cargo at all, because cargo publish will fail with
    // a confusing 400 from crates.io after compiling the crate and every
    // transitive dep. Assert:
    //   1. publish() rejects with the stable error code
    //   2. `cargo` was never invoked
    await expect(publish({ cwd: repo })).rejects.toThrow(
      /PIOT_CRATES_MISSING_METADATA/,
    );

    const cargoCalls = execMock.mock.calls.filter(
      ([cmd]) => cmd === 'cargo',
    );
    expect(cargoCalls).toHaveLength(0);
  });

  it('error names every missing field (description AND license) in one error', async () => {
    // Reports every failing field per package in one error rather than
    // failing on the first — same pattern as requireProvenanceMetadata.
    try {
      await publish({ cwd: repo });
      throw new Error('expected publish to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('description');
      expect(msg).toContain('license');
      expect(msg).toContain('lib-rs');
    }
  });

  it('passes preflight when Cargo.toml carries description + license', async () => {
    // Without this sanity check, a regression that always-throws on
    // crates packages would also satisfy the red test above. This pins
    // the other half of the contract: well-formed Cargo.toml proceeds
    // past the new preflight gate.
    writeRepoFile('packages/rust/Cargo.toml', CARGO_TOML_WELL_FORMED);
    gitInRepo(['add', '-A']);
    gitInRepo(['commit', '-m', 'fix: add metadata\n\nrelease: patch']);

    // The handler will hit crates.io to check isPublished; msw stands in
    // and returns 404 (not yet published), and the cargo dispatcher
    // returns success.
    const result = await publish({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['lib-rs']);

    // And `cargo publish` *was* invoked this time.
    const cargoPublishCalls = execMock.mock.calls.filter(
      ([cmd, args]) =>
        cmd === 'cargo' && Array.isArray(args) && (args as string[])[0] === 'publish',
    );
    expect(cargoPublishCalls.length).toBeGreaterThan(0);
  });

  it('accepts `license-file` as a substitute for `license`', async () => {
    // crates.io requires `license` OR `license-file`; either satisfies
    // the metadata check.
    writeRepoFile(
      'packages/rust/Cargo.toml',
      `[package]
name = "lib-rs"
version = "0.0.0"
edition = "2021"
description = "A test crate."
license-file = "LICENSE"
`,
    );
    writeRepoFile('packages/rust/LICENSE', 'MIT');
    gitInRepo(['add', '-A']);
    gitInRepo(['commit', '-m', 'fix: license-file\n\nrelease: patch']);

    const result = await publish({ cwd: repo });
    expect(result.ok).toBe(true);
  });
});
