/**
 * `verify` unit coverage — drives the CLI end to end (`run(['verify', …])`)
 * against a real temp repo with only `global.fetch` mocked (crates
 * `latestVersion` + `trustPosture`), the tier patch-coverage reads.
 * Exercises every posture (`oidc` / `token` / `unpublished` /
 * `unreachable`), the renderer, the `--json` and human arms, and `--check`.
 * Cross-registry behaviour is pinned at the integration + e2e tiers.
 *
 * Issue #414, #403 slice 5.
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

/**
 * Mock crates.io. `/api/v1/crates/{name}` is latestVersion;
 * `/api/v1/crates/{name}/{version}` is trustPosture (trustpub_data).
 */
function mockCrates(): void {
  vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const two = /\/api\/v1\/crates\/([^/?]+)\/([^/?]+)/.exec(url);
    if (two) {
      const name = two[1];
      if (name === 'trustflakycrate') {return Promise.resolve(new Response('{}', { status: 503 }));}
      const trustpub = name === 'oidccrate' ? { provider: 'github' } : null;
      return Promise.resolve(
        new Response(JSON.stringify({ version: { trustpub_data: trustpub } }), { status: 200 }),
      );
    }
    const one = /\/api\/v1\/crates\/([^/?]+)/.exec(url);
    const name = one?.[1];
    if (name === 'unpubcrate') {return Promise.resolve(new Response('{}', { status: 404 }));}
    if (name === 'latestflakycrate') {return Promise.resolve(new Response('{}', { status: 503 }));}
    const newest = name === 'trustflakycrate' ? '2.0.0' : '1.0.0';
    return Promise.resolve(
      new Response(JSON.stringify({ crate: { newest_version: newest } }), { status: 200 }),
    );
  });
}

const CONFIG = `[putitoutthere]
version = 1
${[
  ['pkg-oidc', 'oidccrate'],
  ['pkg-token', 'tokencrate'],
  ['pkg-unpub', 'unpubcrate'],
  ['pkg-latestflaky', 'latestflakycrate'],
  ['pkg-trustflaky', 'trustflakycrate'],
]
  .map(
    ([name, crate]) => `[[package]]
name  = "${name}"
kind  = "crates"
crate = "${crate}"
path  = "packages/${name}"
globs = ["packages/${name}/**"]`,
  )
  .join('\n')}
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'verify-unit-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'putitoutthere.toml'), CONFIG, 'utf8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);

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

interface VerifyRow {
  package: string;
  version: string | null;
  posture: string;
}

describe('cli: verify', () => {
  it('classifies every posture and emits --json', async () => {
    mockCrates();
    const code = await run(['node', 'piot', 'verify', '--json', '--cwd', repo]);
    const rows = JSON.parse(stdoutChunks.join('')) as VerifyRow[];
    const byPkg = Object.fromEntries(rows.map((r) => [r.package, r]));

    expect(byPkg['pkg-oidc']).toMatchObject({ version: '1.0.0', posture: 'oidc' });
    expect(byPkg['pkg-token']).toMatchObject({ version: '1.0.0', posture: 'token' });
    expect(byPkg['pkg-unpub']).toMatchObject({ version: null, posture: 'unpublished' });
    expect(byPkg['pkg-latestflaky']).toMatchObject({ version: null, posture: 'unreachable' });
    expect(byPkg['pkg-trustflaky']).toMatchObject({ version: '2.0.0', posture: 'unreachable' });
    expect(code).toBe(0);
  });

  it('renders the human table and exits non-zero under --check when token-dependent', async () => {
    mockCrates();
    const code = await run(['node', 'piot', 'verify', '--check', '--cwd', repo]);
    const out = stdoutChunks.join('');

    expect(out).toContain('pkg-oidc  1.0.0  ✓ oidc  trusted publisher');
    expect(out).toContain('pkg-token  1.0.0  ⚠ token  token-dependent');
    expect(out).toContain('pkg-unpub  —  ? unpublished  never published');
    expect(out).toContain('pkg-latestflaky  —  ? unreachable  registry unreachable');
    // `--check` gates on the token-dependent package.
    expect(code).toBe(1);
  });
});
