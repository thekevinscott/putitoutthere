/**
 * The crates publish path bumps the crate's OWN version — integration.
 *
 * Issue #639. `handlers/crates.ts`'s `writeVersionImpl` is the one
 * version-writing path that calls the literal-only rewriter
 * `replaceCargoVersion` directly instead of going through
 * `writeResolvedCargoVersion` (#428), which every other writer
 * (`write-version.ts` for maturin, `write-crate-version.ts` for
 * bundled-cli/napi) uses. That rewriter's regex is
 *
 *     /(\[package\][\s\S]*?)(^\s*version\s*=\s*")([^"]*)(")/m
 *
 * — lazy, and anchored only on the `[package]` *header*, not on the table's
 * extent. When the crate has no literal `[package].version` because it
 * inherits one (`version.workspace = true`), the match walks straight past
 * the table boundary and lands on the next `version = "…"` in the file,
 * which is typically a **dependency's requirement** in a section table.
 *
 * The result is silent and worse than a no-op: the package's own version is
 * never bumped, a dependency's requirement is rewritten to a version of that
 * dependency which does not exist, and the function returns success. A crate
 * released from that manifest fails to resolve — or, if the rewritten
 * requirement happens to be satisfiable, resolves to something nobody chose.
 *
 * Two contracts are pinned here:
 *
 *  1. an inheriting crate has its version bumped at its real source — the
 *     workspace root's `[workspace.package].version` — and every dependency
 *     requirement is left exactly as written;
 *  2. the publish still goes through. Routing to the resolver moves the
 *     write *out* of the package directory, and the handler's pre-publish
 *     dirty-tree guard (#135) refuses on any dirty file outside the manifest
 *     it manages. A fix that swaps silent corruption for a hard refusal is
 *     not a fix, so the guard has to learn about the manifests the resolver
 *     actually wrote.
 *
 * This lives in `tests/integration/` because the corruption is only
 * observable when the real config loader, the real plan, the real workspace-
 * root walk and the real handler dispatch run together against an on-disk
 * cargo workspace. A unit test that hands `replaceCargoVersion` a string
 * proves the regex does what it does; it cannot show that the *publish path*
 * reaches for the wrong writer.
 *
 * Real config loader, real plan, real preflight, real handler dispatch, real
 * git. Mocked seams: the `cargo` subprocess (recorded, never invoked) and
 * crates.io HTTP via msw.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { publish } from '../../src/publish.js';
import { makeServer, makeState, type RegistryState } from './mock-registries.js';

// Integration tests run the first-party process seam (`execCapture`) for
// real and mock only the Node built-in underneath it, so the
// testing-conventions `no-first-party-mock` gate stays satisfied.
// `cargo` is intercepted (record-only); `git` is delegated to the real
// binary so plan()'s reads and the handler's dirty-tree scan run against
// the real fixture repo.
const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

/** A minimal execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

let state: RegistryState;
const server = (() => {
  state = makeState();
  return makeServer(state);
})();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

let repo: string;

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

function read(rel: string): string {
  return readFileSync(join(repo, rel), 'utf8');
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

/**
 * A cargo workspace root that owns the version symbol its member inherits.
 * The member is listed so cargo would accept the tree; nothing here reads
 * `members`, but a fixture that cargo would reject is not worth pinning
 * behaviour against.
 */
const WORKSPACE_ROOT = `[workspace]
members = ["packages/rust"]
resolver = "2"

[workspace.package]
version = "0.0.0"
`;

/**
 * The shape from the bug report: no literal \`[package].version\` (it is
 * inherited), plus a dependency declared in **section-table** form carrying
 * a version requirement. That requirement is the first \`version = "…"\`
 * after the \`[package]\` header, so it is what the lazy regex finds.
 */
const MEMBER_CARGO_TOML = `[package]
name = "lib-rs"
version.workspace = true
edition = "2021"
description = "A test crate."
license = "MIT"

[dependencies.pyo3]
version = "0.22"
features = ["extension-module"]
`;

beforeEach(() => {
  state.crates.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;

  repo = mkdtempSync(join(tmpdir(), 'piot-crates-write-version-'));

  execMock.mockImplementation(((
    cmd: string,
    args: readonly string[],
    opts: unknown,
    cb: (e: Error | null, out: string, err: string) => void,
  ) => {
    if (cmd === 'cargo') {
      cb(null, '', '');
      return fakeChild(0);
    }
    return (realExecFile as unknown as (...a: unknown[]) => ChildProcess.ChildProcess)(
      cmd,
      args,
      opts,
      cb,
    );
  }) as unknown as typeof execFile);

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('Cargo.toml', WORKSPACE_ROOT);
  writeRepoFile('packages/rust/Cargo.toml', MEMBER_CARGO_TOML);
  writeRepoFile('packages/rust/src/lib.rs', '');
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  process.env.CARGO_REGISTRY_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  execMock.mockReset();
  server.resetHandlers();
});

describe('crates writeVersion follows workspace inheritance (#639)', () => {
  it('leaves a dependency requirement exactly as written', async () => {
    await publish({ cwd: repo });
    // The bug rewrites pyo3's requirement to the release version — naming a
    // pyo3 that was never published. Nothing about a release of `lib-rs`
    // should move a third-party requirement, at all, ever.
    expect(read('packages/rust/Cargo.toml')).toContain('version = "0.22"');
  });

  it('bumps the version at its real source, the workspace root', async () => {
    const result = await publish({ cwd: repo });
    const version = result.published[0]?.version;
    expect(version).toBeDefined();
    // `[workspace.package].version` is where an inheriting member's version
    // actually lives; leaving it alone ships the stale literal forever.
    expect(read('Cargo.toml')).toContain(`version = "${version!}"`);
  });

  it('leaves the member manifest inheriting rather than pinning a literal', async () => {
    await publish({ cwd: repo });
    // The inheritance declaration is the consumer's chosen shape. Replacing
    // it with a literal would silently opt them out of workspace versioning.
    expect(read('packages/rust/Cargo.toml')).toContain('version.workspace = true');
  });

  it('still publishes: the dirty-tree guard tolerates the manifests it wrote', async () => {
    // Routing to the resolver moves the write to the workspace root, which
    // is outside the package directory the pre-publish dirty check (#135)
    // allows to be dirty. Without teaching that guard about the resolver's
    // writes, the fix trades silent corruption for `cargo publish: refusing
    // to proceed` — green on the assertions above and still not a release.
    const result = await publish({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['lib-rs']);
    const cargoPublishCalls = execMock.mock.calls.filter(
      ([cmd, args]) => cmd === 'cargo' && Array.isArray(args) && (args as string[])[0] === 'publish',
    );
    expect(cargoPublishCalls.length).toBeGreaterThan(0);
  });
});
