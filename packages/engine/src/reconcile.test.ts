/**
 * `reconcile` unit coverage — drives the CLI end to end (`run([...])`)
 * against a real temp git repo with only `global.fetch` mocked, the same
 * shape `cli: status` uses. This is the tier patch-coverage reads
 * (`test:unit:coverage`), so it exercises every new line: the reconcile
 * loop, the sibling-vs-HEAD commit resolver, the `tagCommit` git helper,
 * and the CLI rendering. End-to-end behaviour is pinned at the
 * integration + e2e tiers; here we cover the wiring.
 *
 * Issue #410, #403 slice 3.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './cli.js';

let repo: string;
const stdoutChunks: string[] = [];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function tagCommitSha(tag: string): string {
  return git(['rev-list', '-n', '1', tag]);
}

function hasTag(tag: string): boolean {
  return git(['tag', '-l', tag]).length > 0;
}

/** Mock crates.io's per-crate latest endpoint from a name->version map. */
function mockRegistry(versions: Record<string, string>): void {
  vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/api\/v1\/crates\/([^/?]+)/.exec(url);
    const v = m ? versions[m[1]!] : undefined;
    return Promise.resolve(
      v === undefined
        ? new Response('{"errors":[{"detail":"Not Found"}]}', { status: 404 })
        : new Response(JSON.stringify({ crate: { newest_version: v } }), { status: 200 }),
    );
  });
}

function writeConfig(body: string): void {
  writeFileSync(join(repo, 'putitoutthere.toml'), body, 'utf8');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
}

const ONE_PKG = `[putitoutthere]
version = 1
[[package]]
name  = "core-rust"
kind  = "crates"
crate = "core"
path  = "packages/core"
globs = ["packages/core/**"]
`;

const THREE_PKG = `[putitoutthere]
version = 1
[[package]]
name  = "core-rust"
kind  = "crates"
crate = "core"
path  = "packages/core"
globs = ["packages/core/**"]
[[package]]
name  = "other-rust"
kind  = "crates"
crate = "other"
path  = "packages/other"
globs = ["packages/other/**"]
[[package]]
name  = "helper-rust"
kind  = "crates"
crate = "helper"
path  = "packages/helper"
globs = ["packages/helper/**"]
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'reconcile-unit-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  // ensureTag warns when the push fails (no remote here); keep it off the
  // reporter and out of the captured stdout.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

describe('cli: reconcile', () => {
  it('backfills at the sibling tag commit and leaves in-sync packages untouched', async () => {
    writeConfig(THREE_PKG);
    const siblingCommit = git(['rev-parse', 'HEAD']);
    // other + helper released at this commit; core never got a tag.
    git(['tag', '-a', '-m', 'other-rust-v2.0.0', 'other-rust-v2.0.0']);
    git(['tag', '-a', '-m', 'helper-rust-v0.1.0', 'helper-rust-v0.1.0']);
    git(['commit', '-q', '--allow-empty', '-m', 'later work']);
    const head = git(['rev-parse', 'HEAD']);

    // core live at 0.1.0 (untagged → drift); other in sync at 2.0.0;
    // helper in sync at 0.1.0.
    mockRegistry({ core: '0.1.0', other: '2.0.0', helper: '0.1.0' });

    const code = await run(['node', 'piot', 'reconcile', '--cwd', repo]);
    const out = stdoutChunks.join('');

    // core healed at the sibling's release commit (helper-rust-v0.1.0),
    // not at HEAD; other + helper were already in sync and untouched.
    expect(hasTag('core-rust-v0.1.0')).toBe(true);
    expect(tagCommitSha('core-rust-v0.1.0')).toBe(siblingCommit);
    expect(tagCommitSha('core-rust-v0.1.0')).not.toBe(head);
    expect(out).toContain('core-rust');
    expect(out).toContain('created');
    expect(out).toContain('(sibling)');
    expect(out).toContain('reconcile: created 1 tag(s)');
    expect(code).toBe(0);
  });

  it('falls back to HEAD when no sibling tag exists, emitting --json', async () => {
    writeConfig(ONE_PKG);
    const head = git(['rev-parse', 'HEAD']);
    mockRegistry({ core: '0.1.0' });

    const code = await run(['node', 'piot', 'reconcile', '--json', '--cwd', repo]);

    expect(hasTag('core-rust-v0.1.0')).toBe(true);
    expect(tagCommitSha('core-rust-v0.1.0')).toBe(head);
    const result = JSON.parse(stdoutChunks.join('')) as {
      dryRun: boolean;
      actions: Array<{ package: string; source: string; created: boolean; tag: string }>;
    };
    expect(result.dryRun).toBe(false);
    expect(result.actions).toEqual([
      expect.objectContaining({
        package: 'core-rust',
        tag: 'core-rust-v0.1.0',
        source: 'head',
        created: true,
      }),
    ]);
    expect(code).toBe(0);
  });

  it('--dry-run reports the heal without writing a tag', async () => {
    writeConfig(ONE_PKG);
    mockRegistry({ core: '0.1.0' });

    const code = await run(['node', 'piot', 'reconcile', '--dry-run', '--cwd', repo]);
    const out = stdoutChunks.join('');

    expect(out).toContain('would create');
    expect(out).toContain('core-rust-v0.1.0');
    expect(hasTag('core-rust-v0.1.0')).toBe(false);
    expect(code).toBe(0);
  });
});
