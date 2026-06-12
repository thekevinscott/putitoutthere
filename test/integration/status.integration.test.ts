/**
 * `piot status` — registry-vs-tag drift detection (integration).
 *
 * The registry is the source of truth; git tags are a cache. `status`
 * reconciles each package's latest git tag (the same `lastTag` resolver
 * the planner and the publish path use) against the registry's latest
 * published version, and flags any drift between the two.
 *
 * Motivating incident (#403): a crate published to crates.io whose
 * release run died before the tagging step. piot derives "last released
 * version" from git tags, so its state silently diverged from the
 * registry — `isPublished` saw the version live, the run "skipped
 * cleanly", and the missing tag never healed. The package got stuck:
 * with no baseline tag it fell back to `first_version`, already
 * published, so it skipped forever and could never bump.
 *
 * This lives in the integration tier, not unit, because the bug is only
 * observable when the real config loader, the real `lastTag` resolver,
 * and the real per-kind registry dispatch run together against a real
 * git tag state. A unit test with a mock handler can't observe "the tag
 * the planner would read is absent while the registry says published" —
 * the mock handler is the very thing that would have to notice the gap,
 * and it doesn't. Only the registry HTTP boundary is mocked (msw);
 * config, tags, and handler dispatch are real.
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
 * `status` reads each registry's *latest* version — distinct from the
 * version-exists endpoints the publish path's `isPublished` hits:
 *   crates.io  GET /api/v1/crates/{name}      -> crate.newest_version
 *   npm        GET registry.npmjs.org/{name}  -> dist-tags.latest
 *   PyPI       GET /pypi/{name}/json          -> info.version
 * A name present in the matching map resolves to that latest version;
 * absent -> 404 (never published).
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

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function tag(name: string): void {
  gitInRepo(['tag', '-a', '-m', name, name]);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-status-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);

  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  // Keep the red-phase unknown-command usage banner (and any diagnostics)
  // off the test reporter.
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

// The package family lives in an on-disk fixture so the test body stays
// about behaviour, not config literals. The crate's crates.io name
// (`mycrate`) differs from its piot id (`mycrate-rust`) on purpose — it
// exercises the `crate`-override name resolution `status` shares with
// the publish path's `isPublished`.
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

describe('piot status: registry-vs-tag drift (#403)', () => {
  it('flags a crate that is published-but-untagged and exits non-zero under --check', async () => {
    writeConfigAndCommit();

    // npm + pypi released cleanly: registry live AND a matching tag.
    tag('mycrate-npm-v0.0.1');
    tag('mycrate-py-v0.0.1');
    latest.npm.set('mycrate-npm', '0.0.1');
    latest.pypi.set('mycrate-py', '0.0.1');

    // The crate is live at 0.0.1 on crates.io, but its release run died
    // before the tagging step: there is NO `mycrate-rust-v*` tag.
    latest.crates.set('mycrate', '0.0.1');

    const code = await run([
      'node', 'piot', 'status', '--check', '--json', '--cwd', repo,
    ]);
    const out = stdoutChunks.join('');

    // The drift the incident hit: published on the registry, no git tag.
    expect(out).toContain('mycrate-rust');
    expect(out).toContain('published, untagged');
    // `--check` turns drift into a CI gate.
    expect(code).not.toBe(0);
  });

  it('exits zero when every package is in sync (tag matches registry)', async () => {
    writeConfigAndCommit();

    for (const t of ['mycrate-rust-v0.0.1', 'mycrate-npm-v0.0.1', 'mycrate-py-v0.0.1']) {
      tag(t);
    }
    latest.crates.set('mycrate', '0.0.1');
    latest.npm.set('mycrate-npm', '0.0.1');
    latest.pypi.set('mycrate-py', '0.0.1');

    const code = await run(['node', 'piot', 'status', '--check', '--cwd', repo]);

    expect(code).toBe(0);
  });
});
