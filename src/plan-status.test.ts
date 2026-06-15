/**
 * `plan` publish/skip + skew unit coverage — drives the CLI end to end
 * (`run(['plan', …])`) against a real temp repo with only `global.fetch`
 * mocked (crates `isPublished`), the tier patch-coverage reads. Exercises
 * `computePlanStatus`, the skew detector, and the CLI rendering (both
 * `--json` and the human verdict marks). End-to-end behaviour is pinned
 * at the integration + e2e tiers; here we cover the wiring.
 *
 * Issue #412, #403 slice 4.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './cli.js';

let repo: string;
const stdoutChunks: string[] = [];

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Mock crates.io `isPublished`: GET /api/v1/crates/{name}/{version}. */
function mockRegistry(opts: { published?: string[]; transient?: string[] }): void {
  const published = new Set(opts.published ?? []);
  const transient = new Set(opts.transient ?? []);
  vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/api\/v1\/crates\/([^/?]+)\/([^/?]+)/.exec(url);
    const name = m?.[1];
    const version = m?.[2];
    if (name !== undefined && transient.has(name)) {
      return Promise.resolve(new Response('{}', { status: 503 }));
    }
    return Promise.resolve(
      name !== undefined && version !== undefined && published.has(`${name}@${version}`)
        ? new Response(JSON.stringify({ version: { num: version } }), { status: 200 })
        : new Response('{"errors":[]}', { status: 404 }),
    );
  });
}

function writeConfig(body: string): void {
  writeFileSync(join(repo, 'putitoutthere.toml'), body, 'utf8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'plan-status-unit-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

const TWO = `[putitoutthere]
version = 1
[[package]]
name = "a"
kind = "crates"
crate = "acrate"
path = "packages/a"
globs = ["packages/a/**"]
[[package]]
name = "b"
kind = "crates"
crate = "bcrate"
path = "packages/b"
globs = ["packages/b/**"]
`;

describe('cli: plan publish/skip', () => {
  it('emits {matrix, verdicts, skew} on --json', async () => {
    writeConfig(TWO);
    mockRegistry({ published: ['acrate@1.0.0'] }); // a SKIP, b PUBLISH
    const code = await run([
      'node', 'piot', 'plan', '--json', '--cwd', repo,
      '--release-packages', 'a@1.0.0, b@1.0.0',
    ]);
    const out = JSON.parse(stdoutChunks.join('')) as {
      matrix: Array<{ name: string }>;
      verdicts: Array<{ package: string; verdict: string }>;
      skew: unknown[];
    };
    expect(out.matrix.map((r) => r.name).sort()).toEqual(['a', 'b']);
    expect(Object.fromEntries(out.verdicts.map((v) => [v.package, v.verdict]))).toEqual({
      a: 'skip',
      b: 'publish',
    });
    expect(out.skew).toEqual([]);
    expect(code).toBe(0);
  });

  it('renders verdict marks + a skew warning in the human output', async () => {
    writeConfig(`[putitoutthere]
version = 1
[[package]]
name = "core"
kind = "crates"
crate = "corecrate"
path = "packages/core"
globs = ["packages/core/**"]
[[package]]
name = "wrap"
kind = "crates"
crate = "wrapcrate"
path = "packages/wrap"
globs = ["packages/wrap/**"]
depends_on = ["core", "flaky"]
[[package]]
name = "flaky"
kind = "crates"
crate = "flakycrate"
path = "packages/flaky"
globs = ["packages/flaky/**"]
`);
    // core SKIP (live); wrap PUBLISH and depends on core (→ skew) + flaky
    // (UNKNOWN, not skip → no skew pair); flaky 5xx → UNKNOWN.
    mockRegistry({ published: ['corecrate@1.0.0'], transient: ['flakycrate'] });
    const code = await run([
      'node', 'piot', 'plan', '--cwd', repo,
      '--release-packages', 'core@1.0.0, wrap@1.0.0, flaky@1.0.0',
    ]);
    const out = stdoutChunks.join('');

    expect(out).toContain('publish plan:');
    expect(out).toContain('core  1.0.0  SKIP');
    expect(out).toContain('wrap  1.0.0  PUBLISH');
    expect(out).toContain('flaky  1.0.0  UNKNOWN');
    expect(out).toContain('version skew: wrap would PUBLISH while its dependency core SKIPs');
    // flaky is a dependency of wrap but UNKNOWN, not skip — no skew pair.
    expect(out).not.toContain('dependency flaky');
    expect(code).toBe(0);
  });
});
