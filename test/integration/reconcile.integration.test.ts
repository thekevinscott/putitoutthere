/**
 * `piot reconcile` — backfill missing tags for published-but-untagged
 * packages (integration). The on-demand companion to the publish-path
 * auto-heal (#407): where auto-heal only fires for a package that is
 * already in a publish run, `reconcile` heals an already-stuck package
 * without a release.
 *
 * reconcile is a thin reader over the same engine `status` (#403 slice 1)
 * uses to *detect* the drift and the same `ensureTag` primitive the
 * publish path (#407 slice 2) uses to *write* the tag — so what it heals
 * can never disagree with what `status` reports or what a release would
 * cut. Only the registry HTTP boundary is mocked (msw); config, tags,
 * handler dispatch, and the git tag writes are real.
 *
 * The commit a backfilled tag points at matters: piot reads "changed
 * since last release" from the tag's commit. reconcile prefers a sibling
 * package already tagged at the same version (the real release commit),
 * falling back to HEAD only when no sibling tag exists. This is the
 * e2e twin of `test/e2e/reconcile.e2e.test.ts`.
 *
 * Issue #410, #403 slice 3.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

/* --------------------------- registry mocks --------------------------- *
 * reconcile reads each registry's *latest* version through the same
 * per-kind handler `status` uses:
 *   crates.io  GET /api/v1/crates/{name}      -> crate.newest_version
 *   npm        GET registry.npmjs.org/{name}  -> dist-tags.latest
 *   PyPI       GET /pypi/{name}/json          -> info.version
 * Present in the map -> that latest version; absent -> 404 (never
 * published).
 */
const latest = {
  crates: new Map<string, string>(),
  npm: new Map<string, string>(),
  pypi: new Map<string, string>(),
};

const server = setupServer(
  http.get('https://crates.io/api/v1/crates/:name', ({ params }) => {
    const v = latest.crates.get(String(params.name));
    return v === undefined
      ? new HttpResponse('{"errors":[{"detail":"Not Found"}]}', { status: 404 })
      : HttpResponse.json({ crate: { newest_version: v } });
  }),
  http.get('https://registry.npmjs.org/:name', ({ params }) => {
    const v = latest.npm.get(String(params.name));
    return v === undefined
      ? new HttpResponse('{}', { status: 404 })
      : HttpResponse.json({ 'dist-tags': { latest: v }, versions: { [v]: {} } });
  }),
  http.get('https://pypi.org/pypi/:name/json', ({ params }) => {
    const v = latest.pypi.get(String(params.name));
    return v === undefined
      ? new HttpResponse('{"message":"Not Found"}', { status: 404 })
      : HttpResponse.json({ info: { version: v } });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/* ------------------------------- git repo ------------------------------- */

let repo: string;
const stdoutChunks: string[] = [];

function gitInRepo(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

/** Empty commit; returns its SHA. */
function commit(message: string): string {
  gitInRepo(['commit', '-q', '--allow-empty', '-m', message]);
  return gitInRepo(['rev-parse', 'HEAD']);
}

function tagAtHead(name: string): void {
  gitInRepo(['tag', '-a', '-m', name, name]);
}

function tagCommitSha(tag: string): string {
  return gitInRepo(['rev-list', '-n', '1', tag]);
}

function hasTag(tag: string): boolean {
  return gitInRepo(['tag', '-l', tag]).length > 0;
}

// Reuse the `status` drift fixture: a Rust crate (crates.io name
// `mycrate`, piot id `mycrate-rust`) wrapped by an npm and a PyPI
// package. reconcile heals exactly the drift `status` flags, so the two
// share a scenario.
const FIXTURE_CONFIG = join(
  fileURLToPath(import.meta.url),
  '..',
  'fixtures',
  'status',
  'putitoutthere.toml',
);

function writeConfigAndCommit(): void {
  cpSync(FIXTURE_CONFIG, join(repo, 'putitoutthere.toml'));
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-reconcile-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  // Keep the red-phase unknown-command banner + the no-remote push
  // warning off the test reporter.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  latest.crates.clear();
  latest.npm.clear();
  latest.pypi.clear();
  rmSync(repo, { recursive: true, force: true });
});

describe('piot reconcile: backfill missing tags (#410)', () => {
  it("creates the missing tag at the sibling package's release commit", async () => {
    writeConfigAndCommit();

    // The npm sibling released cleanly at 0.0.1 at a distinct commit;
    // capture it so we can prove reconcile tags the crate THERE, not at
    // a later HEAD.
    const siblingCommit = commit('npm + crate release');
    tagAtHead('mycrate-npm-v0.0.1');
    latest.npm.set('mycrate-npm', '0.0.1');
    // Later, unrelated work moves HEAD past the release commit.
    const head = commit('later work');

    // The crate is live at 0.0.1 on crates.io but its release run died
    // before tagging — there is no `mycrate-rust-v*` tag.
    latest.crates.set('mycrate', '0.0.1');

    const code = await run(['node', 'piot', 'reconcile', '--cwd', repo]);
    const out = stdoutChunks.join('');

    // Healed: the missing crate tag now exists...
    expect(out, out).toContain('mycrate-rust');
    expect(hasTag('mycrate-rust-v0.0.1')).toBe(true);
    // ...and points at the sibling's release commit, not a later HEAD.
    expect(tagCommitSha('mycrate-rust-v0.0.1')).toBe(siblingCommit);
    expect(tagCommitSha('mycrate-rust-v0.0.1')).not.toBe(head);
    expect(code).toBe(0);
  });

  it('falls back to HEAD when no sibling is tagged at that version, and emits --json', async () => {
    writeConfigAndCommit();
    const head = gitInRepo(['rev-parse', 'HEAD']);

    // The crate is live at 0.0.1, untagged. npm + pypi are unreleased
    // (no tag, absent from their registries), so there is no sibling tag
    // at 0.0.1 whose commit reconcile could borrow.
    latest.crates.set('mycrate', '0.0.1');

    const code = await run(['node', 'piot', 'reconcile', '--json', '--cwd', repo]);

    // Outcome first (a clean assertion failure in the red phase)...
    expect(hasTag('mycrate-rust-v0.0.1')).toBe(true);
    expect(tagCommitSha('mycrate-rust-v0.0.1')).toBe(head);
    // ...then the machine-readable shape.
    const result = JSON.parse(stdoutChunks.join('')) as {
      actions: Array<{ package: string; version: string; source: string; created: boolean }>;
    };
    const action = result.actions.find((a) => a.package === 'mycrate-rust');
    expect(action).toMatchObject({ version: '0.0.1', source: 'head', created: true });
    expect(code).toBe(0);
  });

  it('--dry-run reports the heal but creates no tag', async () => {
    writeConfigAndCommit();
    latest.crates.set('mycrate', '0.0.1');

    const code = await run(['node', 'piot', 'reconcile', '--dry-run', '--cwd', repo]);
    const out = stdoutChunks.join('');

    expect(out).toContain('mycrate-rust');
    expect(out.toLowerCase()).toContain('would');
    expect(hasTag('mycrate-rust-v0.0.1')).toBe(false);
    expect(code).toBe(0);
  });
});
