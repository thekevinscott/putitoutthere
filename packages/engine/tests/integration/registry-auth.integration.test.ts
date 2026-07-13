/**
 * Registry-auth response fixtures, replayed against the engine.
 *
 * Sibling to the publish-shape integration tests (#293/#294/#295). Those
 * cover registry behavior that surfaces as a CLI exit or a tarball-
 * content failure — what the registry receives. This file covers
 * behavior that surfaces in the **response** the engine sees from a
 * registry's auth/publish endpoint — what the registry returns.
 *
 * Why a separate file: the response-fixture catalogue is grep-able as
 * one set, and the catalogue at `notes/upstream-behaviors.md` indexes
 * them. New registry-side behaviors land here as fixture+test+catalog
 * row.
 *
 * Issue #296. Parent: #292.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { crates } from '../../src/handlers/crates.js';
import { npm } from '../../src/handlers/npm.js';
import { pypi } from '../../src/handlers/pypi.js';
import { ErrorCodes } from '../../src/error-codes.js';
import type { Ctx } from '../../src/types.js';

// Literal pinned here rather than imported from ErrorCodes so the test
// commit can land before the constant exists in src/error-codes.ts.
// The impl commit adds the constant; this literal must stay in sync.
const CRATES_FIRST_PUBLISH_TP_REJECTED = 'PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED';

import { loadFixture } from './fixtures/load.js';
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

// onUnhandledRequest: 'error' is load-bearing — it's how the PyPI test
// below asserts the engine never reaches the mint endpoint.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

let workdir: string;

function gitIn(dir: string, args: string[]): void {
  real.execFileSync('git', args, { cwd: dir });
}

function writeAt(dir: string, rel: string, body: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

beforeEach(() => {
  state.crates.clear();
  state.pypi.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;
  state.pypiNextStatus = undefined;
  execMock.mockReset();
  workdir = mkdtempSync(join(tmpdir(), 'piot-registry-auth-int-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  server.resetHandlers();
});

function ctx(env: Record<string, string> = {}): Ctx {
  return {
    cwd: workdir,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env,
    artifacts: { get: () => '', has: () => false },
  };
}

/* ---------------------------------------------------------------- crates */

describe('crates.io: OIDC TP first-publish rejection (#284)', () => {
  // The bug: crates.io's Trusted Publisher feature binds to an
  // already-published crate. The very first publish of a brand-new
  // crate name cannot use the TP path — the OIDC mint succeeds, the
  // exchanged token reaches cargo, but `cargo publish` gets a 404 from
  // the registry ("crate `<name>` does not exist or you do not have
  // permission to publish to it"). The unhelpful error makes the
  // consumer think their TP setup is broken when the real issue is
  // that crates.io expects a bootstrap publish via long-lived token.
  //
  // The engine's job: recognise this specific response shape and
  // surface a clear hint pointing at the CARGO_REGISTRY_TOKEN fallback.

  function setupCratesRepo(): void {
    gitIn(workdir, ['init', '-q', '-b', 'main']);
    gitIn(workdir, ['config', 'user.email', 'test@example.com']);
    gitIn(workdir, ['config', 'user.name', 'Test']);
    gitIn(workdir, ['config', 'commit.gpgsign', 'false']);
    writeAt(workdir, 'Cargo.toml', [
      '[package]',
      'name = "demo-crate"',
      'version = "0.1.0"',
      'edition = "2021"',
      'description = "demo"',
      'license = "MIT"',
      '',
    ].join('\n'));
    writeAt(workdir, 'src/lib.rs', '');
    gitIn(workdir, ['add', '-A']);
    gitIn(workdir, ['commit', '-q', '-m', 'init']);
  }

  function wireCargo(stderrFixture: string): void {
    execMock.mockImplementation(((cmd: string, args: readonly string[], opts?: unknown) => {
      if (cmd === 'cargo') {
        // Simulate cargo's non-zero exit with the captured stderr. The
        // shape (`{ stderr: Buffer }` on the thrown error) matches
        // node:child_process's execFileSync surface that the handler
        // reads in its catch block.
        const err = Object.assign(new Error('cargo publish exit 101'), {
          status: 101,
          stderr: Buffer.from(stderrFixture, 'utf8'),
        });
        throw err;
      }
      return real.execFileSync(
        cmd,
        args as readonly string[],
        opts as Parameters<typeof execFileSync>[2],
      );
    }) as typeof execFileSync);
  }

  it('replays the cargo stderr fixture and surfaces a bootstrap hint pointing at CARGO_REGISTRY_TOKEN', async () => {
    setupCratesRepo();
    wireCargo(loadFixture('crates-io', 'publish-first-publish-tp-rejected.txt'));

    const pkg = { name: 'demo-crate', path: workdir, crate: 'demo-crate' };
    // isPublished returns 404 (not yet on the registry); state.crates is
    // empty so msw answers 404 by default. Then publish runs cargo, which
    // throws with the fixture's stderr. The handler should detect the
    // first-publish-TP-rejection shape and surface the bootstrap hint.
    await expect(crates.publish(pkg, '0.1.0', ctx({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' }))).rejects.toThrow(
      new RegExp(CRATES_FIRST_PUBLISH_TP_REJECTED),
    );
    // And the same call should mention `CARGO_REGISTRY_TOKEN` as the
    // fallback — vague messages here are exactly the symptom the issue
    // is trying to fix.
    await expect(crates.publish(pkg, '0.1.0', ctx({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' }))).rejects.toThrow(
      /CARGO_REGISTRY_TOKEN/,
    );
  });

  it('does NOT surface the bootstrap hint when stderr does not match the first-publish shape', async () => {
    // Sanity check: a generic cargo failure (e.g. compile error in the
    // verification build) should fall through to the existing
    // "cargo publish failed" message rather than misleadingly suggesting
    // CARGO_REGISTRY_TOKEN. Anchors the detector against false positives.
    setupCratesRepo();
    wireCargo('error: could not compile `demo-crate` due to previous error\n');

    const pkg = { name: 'demo-crate', path: workdir, crate: 'demo-crate' };
    await expect(crates.publish(pkg, '0.1.0', ctx({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' }))).rejects.toThrow(
      /cargo publish failed/,
    );
    await expect(crates.publish(pkg, '0.1.0', ctx({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' }))).rejects.not.toThrow(
      new RegExp(CRATES_FIRST_PUBLISH_TP_REJECTED),
    );
  });
});

/* ------------------------------------------------------------------- npm */

describe('npm: E403 over-publish race (#281)', () => {
  // The bug: npm CLI retries a PUT on transient network errors. If the
  // first PUT actually succeeded but the registry's ACK got lost in the
  // wire, the retry lands on a registry that already has the version and
  // gets E403 "cannot publish over the previously published versions".
  // The package IS on the registry — treating the E403 as failure causes
  // a misleading red release. Existing characterisation; the fixture
  // pins the exact stderr shape we depend on.

  function wireNpm(stderrFixture: string): void {
    execMock.mockImplementation(((cmd: string, args: readonly string[]) => {
      const a = args as string[];
      if (cmd === 'npm' && a[0] === 'view') {
        // isPublished probe: throw E404 ("not yet on registry") so the
        // handler proceeds to publish.
        throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      }
      if (cmd === 'npm' && a[0] === 'publish') {
        // The publish itself: throw with the over-publish-race stderr.
        throw Object.assign(new Error('E403'), { status: 1, stderr: Buffer.from(stderrFixture) });
      }
      /* v8 ignore next */
      throw new Error(`unexpected subprocess: ${cmd} ${a.join(' ')}`);
    }) as typeof execFileSync);
  }

  it('replays the npm stderr fixture and short-circuits to already-published', async () => {
    writeAt(workdir, 'package.json', JSON.stringify({
      name: 'demo-pkg',
      version: '0.1.0',
      repository: { type: 'git', url: 'git+https://github.com/acme/demo.git' },
    }));
    wireNpm(loadFixture('npm', 'publish-e403-over-publish.txt'));

    const pkg = { name: 'demo-pkg', path: workdir };
    const result = await npm.publish(pkg, '0.1.0', ctx({ NODE_AUTH_TOKEN: 'tok' }));
    expect(result.status).toBe('already-published');
    expect(result.url).toBe('https://www.npmjs.com/package/demo-pkg/v/0.1.0');
  });
});

describe('npm: provenance requires non-empty `repository` (#281)', () => {
  // The bug: `npm publish --provenance` (the OIDC TP path) requires a
  // non-empty `repository` field so the registry can verify the artifact
  // was built from the repo the trusted publisher declares. The registry
  // surfaces this as a 422 (fixture documents the shape) AFTER the build
  // job has done its work. Wasting a build run on a precondition
  // checkable in milliseconds is exactly what the engine prevents:
  // `assertRepositoryField` rejects locally so the publish never runs
  // and the registry's 422 never fires.

  it('rejects with PIOT_NPM_MISSING_REPOSITORY before invoking npm publish', async () => {
    writeAt(workdir, 'package.json', JSON.stringify({
      name: 'demo-pkg',
      version: '0.1.0',
      // No `repository` field — the bug shape.
    }));
    // npm `view` for isPublished returns 404 so we get to the assertion.
    execMock.mockImplementation(((cmd: string, args: readonly string[]) => {
      const a = args as string[];
      if (cmd === 'npm' && a[0] === 'view') {
        throw Object.assign(new Error('E404'), { status: 1, stderr: Buffer.from('404') });
      }
      /* v8 ignore next */
      throw new Error(`unexpected subprocess: ${cmd} ${a.join(' ')}`);
    }) as typeof execFileSync);

    const pkg = { name: 'demo-pkg', path: workdir };
    await expect(
      npm.publish(pkg, '0.1.0', ctx({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc' })),
    ).rejects.toThrow(new RegExp(ErrorCodes.NPM_MISSING_REPOSITORY));

    // And confirm the publish subprocess was never reached — the entire
    // wasted-build-run failure mode the fixture documents is prevented.
    const publishCalls = execMock.mock.calls.filter(
      ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'publish',
    );
    expect(publishCalls).toHaveLength(0);
  });

  it('fixture captures the npm CLI shape we rely on never having to parse', () => {
    // Characterisation: the fixture exists as documentation of what the
    // registry would return if the local guard were bypassed. If the
    // registry's response shape ever drifts, the catalog entry needs an
    // update — anchor the marker text here so a future shape change at
    // least surfaces in this file's diff.
    const fixture = loadFixture('npm', 'publish-422-missing-repository.txt');
    expect(fixture).toMatch(/422\s+Unprocessable Entity/);
    expect(fixture).toMatch(/repository/);
    expect(fixture).toMatch(/provenance/i);
  });
});

/* ------------------------------------------------------------------- pypi */

describe('pypi: OIDC TP filter rejection for reusable-workflow callers (#252)', () => {
  // The bug: PyPI's TP matcher filters candidate publishers by
  // `repository_owner` BEFORE checking `job_workflow_ref`. OIDC tokens
  // minted from inside a reusable workflow always carry the caller's
  // repository_owner, so a TP registered against the reusable workflow's
  // repo (thekevinscott/putitoutthere) is filtered out before the
  // workflow-ref check. PyPI documents this at warehouse#11096; no
  // timeline. The engine's reaction is architectural: the publish path
  // does NOT call PyPI's mint endpoint or upload endpoint from inside
  // the reusable workflow at all. Upload moves to a caller-side
  // `pypi-publish` job (audit: 2026-04-28-pypi-tp-reusable-workflow-
  // constraint.md). The engine just tags-and-records.

  it('pypi.publish() makes no HTTP calls beyond the isPublished GET', async () => {
    // msw's onUnhandledRequest: 'error' guarantees that any unmocked
    // request fails the test. The isPublished GET is handled by the
    // existing pypi handler in mock-registries.ts; anything else
    // (mint-token, upload, /legacy/) would error.
    const pkg = { name: 'demo-py', path: workdir };
    writeAt(workdir, 'pyproject.toml', [
      '[project]',
      'name = "demo-py"',
      'dynamic = ["version"]',
      '',
      '[tool.hatch.version]',
      'source = "vcs"',
      '',
    ].join('\n'));

    const result = await pypi.publish(pkg, '0.1.0', ctx());
    expect(result.status).toBe('published');
    // Exactly one request, and it was the isPublished GET.
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]!.url).toContain('/pypi/demo-py/0.1.0/json');
    // No subprocess was spawned either — no twine, no python -m build.
    expect(execMock.mock.calls.length).toBe(0);
  });

  it('fixture captures the mint-token response we engineered around', () => {
    // The fixture documents the response shape the engine would face if
    // the upload moved back inside the reusable workflow. Pin the marker
    // strings so a future fixture refresh has to acknowledge the
    // invalid-publisher / repository_owner-filter contract.
    const fixture = JSON.parse(
      loadFixture('pypi', 'oidc-mint-tp-filter-rejected.json')
    ) as { message: string; errors?: Array<{ code: string; description: string }> };
    expect(fixture.message).toMatch(/invalid-publisher/);
    expect(fixture.errors?.[0]?.code).toBe('invalid-publisher');
    expect(fixture.errors?.[0]?.description).toMatch(/repository_owner/);
    expect(fixture.errors?.[0]?.description).toMatch(/job_workflow_ref/);
    expect(fixture.errors?.[0]?.description).toMatch(/warehouse\/issues\/11096/);
  });
});
