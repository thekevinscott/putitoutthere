/**
 * `piot release-github` — "Create GitHub Release(s) for new tag(s)"
 * (integration). Epic #442, sub-issue #444.
 *
 * Extraction of the inline "Create GitHub Release(s) for new tag(s)" bash
 * step in `.github/workflows/release.yml` into one tested engine command.
 * The #436/#437 fragility becomes ordinary code, and this tier pins the
 * contract:
 *
 * - **no-fetch** — the command never runs `git fetch`. Local tag state is
 *   already complete (checkout fetched every remote tag; the engine created
 *   the new tags locally in the same job), and an un-forced `git fetch
 *   --tags` rejects any tag that moved since checkout — a consumer's
 *   floating major tag moving mid-run fails the job after a fully
 *   successful publish (#436).
 * - **ref-scoped-push** — each tag is pushed `git push origin
 *   refs/tags/<tag>`, idempotent and invisible to every other tag, before
 *   its Release is created (heals the engine's warn-only tag push, #407).
 * - **idempotent-create** — the `gh release view` guard stays, so re-runs
 *   skip already-created Releases instead of erroring.
 *
 * This tier drives the CLI in-process (`run([...])`) and mocks only the
 * subprocess boundary (`execFileSync`, for both `git` and `gh`). The e2e
 * twin (`test/e2e/release-github.e2e.test.ts`) shells out to the built CLI
 * against a real git repo + bare remote with a stubbed `gh`.
 *
 * Red before the command exists: `release-github` is an unrecognized
 * command, so `run` prints "unknown command" and exits 1 — no ref-scoped
 * push, no "Created GitHub Release" line.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

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
 * Wire the subprocess boundary. `tags` is what `git tag --points-at HEAD`
 * returns; `existing` is the set of tags whose `gh release view` succeeds
 * (Release already exists). Every call is recorded in `calls` for ordering
 * / absence assertions.
 */
function wire(tags: string[], existing: Set<string> = new Set()): Call[] {
  const calls: Call[] = [];
  execMock.mockImplementation((cmd, args) => {
    const a = (args ?? []) as string[];
    calls.push({ cmd: cmd as string, args: a });
    if (cmd === 'git') {
      if (a[0] === 'tag' && a.includes('--points-at')) {
        return `${tags.join('\n')}\n`;
      }
      // push / anything else: succeed silently.
      return '';
    }
    if (cmd === 'gh') {
      if (a[0] === 'release' && a[1] === 'view') {
        const tag = a[2]!;
        if (existing.has(tag)) return Buffer.from('');
        // gh exits non-zero when the Release does not exist — model the
        // real thrown error so the idempotency guard treats it as absent.
        throw new Error(`release not found: ${tag}`);
      }
      // release create: succeed.
      return Buffer.from('');
    }
    return '';
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
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const gitCalls = (calls: Call[]): Call[] => calls.filter((c) => c.cmd === 'git');
const ghCalls = (calls: Call[]): Call[] => calls.filter((c) => c.cmd === 'gh');

function ghSub(calls: Call[], sub: string, tag: string): number {
  return calls.findIndex(
    (c) => c.cmd === 'gh' && c.args[0] === 'release' && c.args[1] === sub && c.args[2] === tag,
  );
}
function pushIndex(calls: Call[], tag: string): number {
  return calls.findIndex(
    (c) => c.cmd === 'git' && c.args[0] === 'push' && c.args.includes(`refs/tags/${tag}`),
  );
}

describe('piot release-github: no tags on HEAD (#444)', () => {
  it('prints the skip line, exits 0, and never touches gh', async () => {
    const calls = wire([]);

    const code = await run(['node', 'piot', 'release-github', '--cwd', '/tmp/repo']);

    expect(out.join('')).toContain('No tags on HEAD; nothing to release on GitHub.');
    expect(code).toBe(0);
    expect(ghCalls(calls)).toHaveLength(0);
  });
});

describe('piot release-github: creates a Release for a new tag (#444)', () => {
  it('pushes the tag ref-scoped, views, then creates — in that order', async () => {
    const calls = wire(['pkg-v1.0.0']);

    const code = await run(['node', 'piot', 'release-github', '--cwd', '/tmp/repo']);

    const push = pushIndex(calls, 'pkg-v1.0.0');
    const view = ghSub(calls, 'view', 'pkg-v1.0.0');
    const create = ghSub(calls, 'create', 'pkg-v1.0.0');

    expect(push, 'ref-scoped push must happen').toBeGreaterThanOrEqual(0);
    expect(create, 'gh release create must happen').toBeGreaterThanOrEqual(0);
    // ref-scoped push precedes the Release create so the tag is guaranteed
    // on the remote before `gh release create` reads it.
    expect(push).toBeLessThan(create);
    // the idempotency guard runs before create.
    expect(view).toBeGreaterThanOrEqual(0);
    expect(view).toBeLessThan(create);

    // create carries the auto-generated-notes shape verbatim.
    const createCall = calls[create]!;
    expect(createCall.args).toEqual([
      'release', 'create', 'pkg-v1.0.0', '--title', 'pkg-v1.0.0', '--generate-notes',
    ]);

    expect(out.join('')).toContain('Created GitHub Release for pkg-v1.0.0');
    expect(code).toBe(0);
  });

  it('pushes each tag ref-scoped (not a blanket refspec)', async () => {
    const calls = wire(['a-v1.0.0', 'b-v2.0.0']);

    await run(['node', 'piot', 'release-github', '--cwd', '/tmp/repo']);

    const pushes = gitCalls(calls).filter((c) => c.args[0] === 'push');
    expect(pushes).toHaveLength(2);
    for (const p of pushes) {
      // exactly `git push origin refs/tags/<tag>` — never `--tags` or a
      // bare `git push` that would sweep in every local tag.
      expect(p.args[1]).toBe('origin');
      expect(p.args[2]).toMatch(/^refs\/tags\//);
      expect(p.args).not.toContain('--tags');
    }
    expect(ghSub(calls, 'create', 'a-v1.0.0')).toBeGreaterThanOrEqual(0);
    expect(ghSub(calls, 'create', 'b-v2.0.0')).toBeGreaterThanOrEqual(0);
  });
});

describe('piot release-github: idempotent when the Release already exists (#444)', () => {
  it('still pushes the tag ref-scoped but skips gh release create', async () => {
    const calls = wire(['pkg-v1.0.0'], new Set(['pkg-v1.0.0']));

    const code = await run(['node', 'piot', 'release-github', '--cwd', '/tmp/repo']);

    expect(pushIndex(calls, 'pkg-v1.0.0'), 'the ref-scoped push still heals a warn-only engine push').toBeGreaterThanOrEqual(0);
    expect(ghSub(calls, 'view', 'pkg-v1.0.0')).toBeGreaterThanOrEqual(0);
    expect(ghSub(calls, 'create', 'pkg-v1.0.0'), 'must not re-create an existing Release').toBe(-1);
    expect(out.join('')).toContain('GitHub Release pkg-v1.0.0 already exists; skipping.');
    expect(code).toBe(0);
  });
});

describe('piot release-github: no-fetch contract (#436) (#444)', () => {
  it('never runs git fetch in any path', async () => {
    for (const tags of [[], ['pkg-v1.0.0'], ['pkg-v1.0.0', 'other-v2.0.0']]) {
      const calls = wire(tags, new Set(['other-v2.0.0']));
      await run(['node', 'piot', 'release-github', '--cwd', '/tmp/repo']);
      const fetches = gitCalls(calls).filter((c) => c.args[0] === 'fetch');
      expect(fetches, `git fetch must never run (tags=${JSON.stringify(tags)})`).toHaveLength(0);
    }
  });
});
