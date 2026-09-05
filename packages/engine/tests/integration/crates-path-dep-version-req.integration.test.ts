/**
 * A crates release rewrites the in-repo requirements pointing at it —
 * integration.
 *
 * Issue #640. #621 taught the **build**-time writers (`write-version.ts` for
 * maturin, `write-crate-version.ts` for bundled-cli/napi) to bump every
 * in-repo crate an artifact embeds *and* rewrite every version requirement
 * pointing at those crates. The **publish** path never learned either half.
 * `handlers/crates.ts`'s `writeVersionImpl` bumps exactly one manifest: the
 * crate's own.
 *
 * So for two crates.io packages in one repo where A path-deps B:
 *
 *     # packages/host/Cargo.toml
 *     [dependencies]
 *     expcore = { path = "../core", version = "0.2" }
 *
 * releasing B at 0.4.2 moves B past A's requirement and nothing updates A.
 * Cargo then refuses to resolve at all:
 *
 *     error: failed to select a version for the requirement `expcore = "^0.2"`
 *     candidate versions found which didn't match: 0.4.2
 *     location searched: …/packages/core
 *
 * A hard failure (exit 101) before anything compiles or packages — and an
 * intermittent one, since a repo on a patch cadence stays green until the
 * first bump that leaves the declared range.
 *
 * A `version` key alongside `path` is **mandatory** for any crate that also
 * publishes to crates.io, so the shape that breaks is exactly the shape a
 * multi-crate crates.io repo is required to have.
 *
 * The rewrite is deliberately narrow: only requirements that point at the
 * crate this run actually bumped move. A registry dependency that happens to
 * share a key name keeps its requirement — pinning `pyo3` to piot's release
 * version would name a pyo3 that does not exist.
 *
 * Real config loader, real plan, real preflight, real handler dispatch, real
 * git, against an on-disk cargo workspace. Mocked seams: the `cargo`
 * subprocess (recorded, never invoked) and crates.io HTTP via msw. The e2e
 * twin (`tests/e2e/crates-path-dep-version-req.e2e.test.ts`) runs real cargo
 * resolution over the result, which is the tier that can prove the tree is
 * actually buildable rather than merely textually plausible.
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

const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

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

/**
 * The body of a section table, up to the next table header. Assertions scope
 * to this rather than the whole manifest: the crate's own `[package].version`
 * is bumped to the same release version, so a file-wide `toContain` would
 * pass on the package's own line and never notice the dependency's
 * requirement standing still.
 */
function section(rel: string, header: string): string {
  const body = read(rel).split(`${header}\n`)[1];
  if (body === undefined) {throw new Error(`${rel} has no ${header} table`);}
  return body.split('\n[')[0]!;
}

const TOML = `
[putitoutthere]
version = 1

# 0.4.2 so the release lands outside the "0.2" requirement the host
# declares -- the shape that makes cargo refuse to resolve.
[[package]]
name  = "expcore"
kind  = "crates"
path  = "packages/core"
globs = ["packages/core/**"]
first_version = "0.4.2"

[[package]]
name  = "exphost"
kind  = "crates"
path  = "packages/host"
globs = ["packages/host/**"]
depends_on = ["expcore"]
first_version = "0.4.2"
`;

const CORE_CARGO = `[package]
name = "expcore"
version = "0.2.0"
edition = "2021"
description = "The core crate."
license = "MIT"
`;

/** `[package]` preamble shared by every host-manifest variant. */
const HOST_PREAMBLE = `[package]
name = "exphost"
version = "0.2.0"
edition = "2021"
description = "The host crate."
license = "MIT"
`;

const WORKSPACE_ROOT = `[workspace]
members = ["packages/core", "packages/host"]
resolver = "2"
`;

/** Rewrite the host manifest and the workspace root, then re-commit. */
function scaffold(hostBody: string, workspaceRoot = WORKSPACE_ROOT): void {
  writeRepoFile('Cargo.toml', workspaceRoot);
  writeRepoFile('packages/host/Cargo.toml', hostBody);
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: shape\n\nrelease: patch']);
}

beforeEach(() => {
  state.crates.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;

  repo = mkdtempSync(join(tmpdir(), 'piot-crates-path-dep-'));

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
  writeRepoFile('packages/core/Cargo.toml', CORE_CARGO);
  writeRepoFile('packages/core/src/lib.rs', '');
  writeRepoFile('packages/host/src/lib.rs', '');
  gitInRepo(['add', '-A']);

  process.env.CARGO_REGISTRY_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.CARGO_REGISTRY_TOKEN;
  execMock.mockReset();
  server.resetHandlers();
});

describe('crates publish rewrites in-repo path-dep requirements (#640)', () => {
  it('moves an inline-table requirement to the released version', async () => {
    scaffold(`${HOST_PREAMBLE}\n[dependencies]\nexpcore = { path = "../core", version = "0.2" }\n`);

    const result = await publish({ cwd: repo });
    const version = result.published.find((p) => p.package === 'expcore')?.version;
    expect(version).toBeDefined();

    // Left at `0.2`, cargo refuses to resolve the moment expcore leaves that
    // range — before a line compiles.
    expect(read('packages/host/Cargo.toml')).toContain(
      `expcore = { path = "../core", version = "${version!}" }`,
    );
  });

  it('moves a section-table requirement too', async () => {
    scaffold(
      `${HOST_PREAMBLE}\n[dependencies.expcore]\npath = "../core"\nversion = "0.2"\nfeatures = []\n`,
    );

    const result = await publish({ cwd: repo });
    const version = result.published.find((p) => p.package === 'expcore')!.version;

    // Same declaration, different syntax; cargo treats them identically, so
    // a rewrite that only understands one form still ships a broken tree.
    const dep = section('packages/host/Cargo.toml', '[dependencies.expcore]');
    expect(dep).toContain('path = "../core"');
    expect(dep).toContain(`version = "${version}"`);
  });

  it('moves a requirement that lives in [workspace.dependencies]', async () => {
    scaffold(
      `${HOST_PREAMBLE}\n[dependencies]\nexpcore.workspace = true\n`,
      `${WORKSPACE_ROOT}\n[workspace.dependencies]\nexpcore = { path = "packages/core", version = "0.2" }\n`,
    );

    const result = await publish({ cwd: repo });
    const version = result.published.find((p) => p.package === 'expcore')!.version;

    // An inheriting member's requirement lives at the workspace root — a
    // file no member's own rewrite would ever touch.
    expect(read('Cargo.toml')).toContain(
      `expcore = { path = "packages/core", version = "${version}" }`,
    );
  });

  it('leaves a registry dependency alone', async () => {
    scaffold(
      `${HOST_PREAMBLE}\n[dependencies]\nexpcore = { path = "../core", version = "0.2" }\n` +
        'pyo3 = { version = "0.22", features = ["extension-module"] }\n',
    );

    await publish({ cwd: repo });

    // Only requirements pointing at a crate this run bumped may move.
    // Rewriting pyo3 would pin a pyo3 release that does not exist.
    expect(read('packages/host/Cargo.toml')).toContain('pyo3 = { version = "0.22"');
  });

  it('still publishes both packages, in dependency order', async () => {
    scaffold(`${HOST_PREAMBLE}\n[dependencies]\nexpcore = { path = "../core", version = "0.2" }\n`);

    // Rewriting the dependent's manifest dirties a file outside the
    // package directory the pre-publish dirty-tree guard (#135) allows.
    // A fix that trades an unbuildable tree for `refusing to proceed` is
    // not a fix.
    const result = await publish({ cwd: repo });
    expect(result.ok).toBe(true);
    expect(result.published.map((p) => p.package)).toEqual(['expcore', 'exphost']);
  });
});
