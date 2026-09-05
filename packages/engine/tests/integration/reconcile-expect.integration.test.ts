/**
 * `piot reconcile --expect <name>@<version>` — the post-upload assertion
 * that a CDN-cached latest-version pointer cannot defeat (#666).
 *
 * `pypi-tag.yml` runs `reconcile` seconds after the caller's
 * `pypi-publish` job uploads. Bare reconcile *discovers* what to tag by
 * reading each registry's **mutable latest-version pointer** — for PyPI,
 * `GET /pypi/{name}/json` -> `info.version`, which pypi.org serves with
 * `cache-control: max-age=900, public` from multi-tier Fastly. In that
 * window the pointer can still name the PREVIOUS release, which in
 * steady state already carries its tag: reconcile skips it, reports
 * `created 0 tag(s)`, and exits 0 with the tag it was run to cut absent.
 * A silent no-op reported as success is the exact failure mode #623
 * exists to prevent.
 *
 * `--expect` removes the discovery step: the caller states what it
 * uploaded, and reconcile confirms it against the **immutable
 * per-version endpoint** (`/pypi/{name}/{version}/json`, the same read
 * `isPublished` performs on the publish path) rather than the cached
 * pointer. Confirmed and untagged -> tag it. Not confirmed -> fail
 * loudly, non-zero, rather than exit 0 having done nothing.
 *
 * Only the registry HTTP boundary is mocked (msw); config, tags, handler
 * dispatch, and the git tag writes are real. This is the in-process twin
 * of `tests/e2e/reconcile-expect.e2e.test.ts`.
 *
 * Issue #666.
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
 * Two PyPI reads, deliberately allowed to disagree — that disagreement IS
 * the bug under test:
 *
 *   GET /pypi/{name}/json            -> info.version    (mutable pointer,
 *                                       CDN-cached 900s; `pointer` below)
 *   GET /pypi/{name}/{version}/json  -> 200 | 404       (immutable, and
 *                                       pypi.org does not cache the 404;
 *                                       `published` below)
 *
 * `pointer` is what a stale edge would serve; `published` is registry
 * truth. Absent from `pointer` -> 404 (never published). `pointerStatus`
 * forces an error on the pointer read alone, so a test can prove the
 * expectation path never depends on it.
 */
const pointer = new Map<string, string>();
const published = new Map<string, Set<string>>();
let pointerStatus: number | null = null;

function isLive(name: string, version: string): boolean {
  return published.get(name)?.has(version) ?? false;
}

const server = setupServer(
  http.get('https://pypi.org/pypi/:name/json', ({ params }) => {
    if (pointerStatus !== null) {
      return new HttpResponse('{"message":"upstream"}', { status: pointerStatus });
    }
    const v = pointer.get(String(params.name));
    return v === undefined
      ? new HttpResponse('{"message":"Not Found"}', { status: 404 })
      : HttpResponse.json({ info: { version: v } });
  }),
  http.get('https://pypi.org/pypi/:name/:version/json', ({ params }) =>
    isLive(String(params.name), String(params.version))
      ? HttpResponse.json({ info: { version: String(params.version) } })
      : new HttpResponse('{"message":"Not Found"}', { status: 404 }),
  ),
  // The fixture config is polyglot; the crates/npm siblings are simply
  // never published in these scenarios.
  http.get('https://crates.io/api/v1/crates/:name', () =>
    new HttpResponse('{"errors":[{"detail":"Not Found"}]}', { status: 404 }),
  ),
  http.get('https://registry.npmjs.org/:name', () => new HttpResponse('{}', { status: 404 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/* ------------------------------- git repo ------------------------------- */

let repo: string;
const stdoutChunks: string[] = [];
const stderrChunks: string[] = [];

function gitInRepo(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

function commit(message: string): string {
  gitInRepo(['commit', '-q', '--allow-empty', '-m', message]);
  return gitInRepo(['rev-parse', 'HEAD']);
}

function tagAtHead(name: string): void {
  gitInRepo(['tag', '-a', '-m', name, name]);
}

function hasTag(tag: string): boolean {
  return gitInRepo(['tag', '-l', tag]).length > 0;
}

function output(): string {
  return `${stdoutChunks.join('')}\n${stderrChunks.join('')}`;
}

// Shared with the `status` / `reconcile` fixtures: a Rust crate wrapped
// by an npm and a PyPI package (`mycrate-py`).
const FIXTURE_CONFIG = join(
  fileURLToPath(import.meta.url),
  '..',
  'fixtures',
  'status',
  'putitoutthere.toml',
);

/**
 * The steady-state post-upload window: 0.0.1 shipped and is tagged,
 * 0.0.2 has just been uploaded by the caller-side `pypi-publish` job and
 * IS live on PyPI — but the CDN-cached pointer still names 0.0.1.
 */
function stalePointerAfterUpload(): void {
  cpSync(FIXTURE_CONFIG, join(repo, 'putitoutthere.toml'));
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);
  tagAtHead('mycrate-py-v0.0.1');
  commit('py 0.0.2 release');

  published.set('mycrate-py', new Set(['0.0.1', '0.0.2']));
  pointer.set('mycrate-py', '0.0.1'); // stale: 0.0.2 is live, the edge lags
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-reconcile-expect-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  stdoutChunks.length = 0;
  stderrChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  pointer.clear();
  published.clear();
  pointerStatus = null;
  rmSync(repo, { recursive: true, force: true });
});

describe('piot reconcile --expect: a stale latest pointer cannot skip the tag (#666)', () => {
  it('cuts the expected tag that discovery alone silently skips', async () => {
    stalePointerAfterUpload();

    // Control — bare reconcile in this exact window. The pointer names
    // 0.0.1, which already has its tag, so reconcile finds nothing to do
    // and exits 0. That success is the bug: 0.0.2 is live and untagged.
    const discovery = await run(['node', 'piot', 'reconcile', '--cwd', repo]);
    expect(discovery, output()).toBe(0);
    expect(hasTag('mycrate-py-v0.0.2'), output()).toBe(false);

    // Told what the upload actually shipped, reconcile confirms 0.0.2
    // against the immutable per-version endpoint and cuts its tag.
    const code = await run([
      'node',
      'piot',
      'reconcile',
      '--expect',
      'mycrate-py@0.0.2',
      '--cwd',
      repo,
    ]);

    expect(hasTag('mycrate-py-v0.0.2'), output()).toBe(true);
    expect(code, output()).toBe(0);
    // The previous release's tag is left exactly where it was.
    expect(hasTag('mycrate-py-v0.0.1'), output()).toBe(true);
  });

  it('cuts the expected tag even when the latest pointer is unreachable', async () => {
    // The sharpest statement of the contract: the expectation path reads
    // registry truth for ONE named version, so whatever the mutable
    // pointer says — stale, or nothing at all — cannot decide the
    // outcome. A 503 here fails the discovery pass; the tag must still
    // be cut.
    stalePointerAfterUpload();
    pointerStatus = 503;

    const code = await run([
      'node',
      'piot',
      'reconcile',
      '--expect',
      'mycrate-py@0.0.2',
      '--cwd',
      repo,
    ]);

    expect(hasTag('mycrate-py-v0.0.2'), output()).toBe(true);
    expect(code, output()).toBe(0);
  });

  it('fails loudly when the expected version is not on the registry', async () => {
    // The upload silently uploaded nothing. Exiting 0 here would record
    // success for a release that did not happen — the whole point of
    // tagging from registry truth. Refuse, non-zero, and name the
    // version that could not be confirmed.
    stalePointerAfterUpload();
    published.set('mycrate-py', new Set(['0.0.1'])); // 0.0.2 never landed

    const code = await run([
      'node',
      'piot',
      'reconcile',
      '--expect',
      'mycrate-py@0.0.2',
      '--cwd',
      repo,
    ]);

    expect(code, output()).not.toBe(0);
    expect(output()).toContain('mycrate-py');
    expect(output()).toContain('0.0.2');
    // No tag for a version nobody published.
    expect(hasTag('mycrate-py-v0.0.2'), output()).toBe(false);
  });

  it('is a no-op when the expected version is already tagged', async () => {
    // Idempotence survives the new flag: a re-run of `pypi-tag` (or a
    // run whose discovery pass already healed the package) must not
    // error and must not duplicate the tag.
    stalePointerAfterUpload();
    gitInRepo(['tag', '-a', '-m', 'mycrate-py-v0.0.2', 'mycrate-py-v0.0.2']);

    const code = await run([
      'node',
      'piot',
      'reconcile',
      '--expect',
      'mycrate-py@0.0.2',
      '--cwd',
      repo,
    ]);

    expect(code, output()).toBe(0);
    const tags = gitInRepo(['tag', '-l', 'mycrate-py-v0.0.2']).split('\n').filter(Boolean);
    expect(tags).toHaveLength(1);
  });

  it("accepts the release job's delegated_packages JSON verbatim", async () => {
    // `pypi-tag.yml` forwards what the release job already computed —
    // `delegated_packages`, `[{"name","version","tag"}, …]` — without
    // reshaping it in YAML. The engine parses it; the workflow only
    // wires it.
    stalePointerAfterUpload();

    const code = await run([
      'node',
      'piot',
      'reconcile',
      '--expect',
      '[{"name":"mycrate-py","version":"0.0.2","tag":"mycrate-py-v0.0.2"}]',
      '--cwd',
      repo,
    ]);

    expect(hasTag('mycrate-py-v0.0.2'), output()).toBe(true);
    expect(code, output()).toBe(0);
  });

  it('rejects an expectation naming a package the config does not declare', async () => {
    // A typo'd or stale wiring must not pass silently — it would look
    // exactly like "nothing to tag".
    stalePointerAfterUpload();

    const code = await run([
      'node',
      'piot',
      'reconcile',
      '--expect',
      'not-a-package@0.0.2',
      '--cwd',
      repo,
    ]);

    expect(code, output()).not.toBe(0);
    expect(output()).toContain('not-a-package');
  });
});
