/**
 * `releaseGithub` — the "Create GitHub Release(s) for new tag(s)" engine
 * command (#444, epic #442). Colocated unit tests pinning the #436/#437
 * contract that used to live only as a YAML-text test:
 *
 * - **no-fetch** — never runs `git fetch`.
 * - **ref-scoped-push** — `git push origin refs/tags/<tag>` per tag, before
 *   the Release is created.
 * - **idempotent-create** — the `gh release view` guard skips an existing
 *   Release.
 *
 * The subprocess boundary (`execFileSync`, git + gh) is mocked; every call
 * is recorded for ordering / absence assertions.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { releaseGithub } from './index.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

interface Call {
  cmd: string;
  args: string[];
}

/**
 * `tags` is what `git tag --points-at HEAD` returns; `existing` is the set
 * of tags whose `gh release view` succeeds. Returns the recorded call list.
 */
function wire(tags: string[], existing: Set<string> = new Set()): Call[] {
  const calls: Call[] = [];
  execMock.mockImplementation((cmd, args) => {
    const a = (args ?? []) as string[];
    calls.push({ cmd: cmd, args: a });
    if (cmd === 'git') {
      if (a[0] === 'tag' && a.includes('--points-at')) {return `${tags.join('\n')}\n`;}
      return '';
    }
    if (cmd === 'gh' && a[0] === 'release' && a[1] === 'view') {
      if (existing.has(a[2]!)) {return Buffer.from('');}
      throw new Error(`release not found: ${a[2]}`);
    }
    return Buffer.from('');
  });
  return calls;
}

const out: string[] = [];

beforeEach(() => {
  execMock.mockReset();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const idx = (calls: Call[], pred: (c: Call) => boolean): number => calls.findIndex(pred);
const isPush = (tag: string) => (c: Call) =>
  c.cmd === 'git' && c.args[0] === 'push' && c.args.includes(`refs/tags/${tag}`);
const isGh = (sub: string, tag: string) => (c: Call) =>
  c.cmd === 'gh' && c.args[0] === 'release' && c.args[1] === sub && c.args[2] === tag;

describe('releaseGithub: no tags on HEAD', () => {
  it('prints the skip line, returns 0, and touches neither push nor gh', () => {
    const calls = wire([]);
    const code = releaseGithub({ cwd: '/repo' });
    expect(code).toBe(0);
    expect(out.join('')).toContain('No tags on HEAD; nothing to release on GitHub.');
    expect(calls.some((c) => c.cmd === 'gh')).toBe(false);
    expect(calls.some(isPush('any'))).toBe(false);
  });
});

describe('releaseGithub: a new tag', () => {
  it('pushes ref-scoped, then views, then creates — in order', () => {
    const calls = wire(['pkg-v1.0.0']);
    const code = releaseGithub({ cwd: '/repo' });

    const push = idx(calls, isPush('pkg-v1.0.0'));
    const view = idx(calls, isGh('view', 'pkg-v1.0.0'));
    const create = idx(calls, isGh('create', 'pkg-v1.0.0'));

    expect(push).toBeGreaterThanOrEqual(0);
    expect(view).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(push).toBeLessThan(view);
    expect(view).toBeLessThan(create);

    // exact ref-scoped push and generate-notes create shapes.
    expect(calls[push]!.args).toEqual(['push', 'origin', 'refs/tags/pkg-v1.0.0']);
    expect(calls[create]!.args).toEqual([
      'release', 'create', 'pkg-v1.0.0', '--title', 'pkg-v1.0.0', '--generate-notes',
    ]);
    expect(out.join('')).toContain('Created GitHub Release for pkg-v1.0.0');
    expect(code).toBe(0);
  });

  it('handles multiple tags, each pushed ref-scoped and created', () => {
    const calls = wire(['a-v1.0.0', 'b-v2.0.0']);
    releaseGithub({ cwd: '/repo' });
    for (const tag of ['a-v1.0.0', 'b-v2.0.0']) {
      expect(idx(calls, isPush(tag))).toBeGreaterThanOrEqual(0);
      expect(idx(calls, isGh('create', tag))).toBeGreaterThanOrEqual(0);
    }
    const pushes = calls.filter((c) => c.cmd === 'git' && c.args[0] === 'push');
    expect(pushes).toHaveLength(2);
    expect(pushes.every((p) => p.args[1] === 'origin' && p.args[2]!.startsWith('refs/tags/'))).toBe(true);
  });
});

describe('releaseGithub: existing Release', () => {
  it('still pushes ref-scoped but skips create', () => {
    const calls = wire(['pkg-v1.0.0'], new Set(['pkg-v1.0.0']));
    const code = releaseGithub({ cwd: '/repo' });
    expect(idx(calls, isPush('pkg-v1.0.0'))).toBeGreaterThanOrEqual(0);
    expect(idx(calls, isGh('view', 'pkg-v1.0.0'))).toBeGreaterThanOrEqual(0);
    expect(idx(calls, isGh('create', 'pkg-v1.0.0'))).toBe(-1);
    expect(out.join('')).toContain('GitHub Release pkg-v1.0.0 already exists; skipping.');
    expect(code).toBe(0);
  });
});

describe('releaseGithub: no-fetch contract (#436)', () => {
  it('never runs git fetch in any path', () => {
    for (const tags of [[], ['pkg-v1.0.0'], ['a-v1.0.0', 'b-v2.0.0']]) {
      const calls = wire(tags, new Set(['b-v2.0.0']));
      releaseGithub({ cwd: '/repo' });
      expect(calls.some((c) => c.cmd === 'git' && c.args[0] === 'fetch')).toBe(false);
    }
  });
});
