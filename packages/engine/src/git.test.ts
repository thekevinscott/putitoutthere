/**
 * Git wrapper tests (#9). The file under test is `git.ts`; its only
 * collaborator is the `git` CLI via the async process seam (`execCapture`),
 * mocked here so each case isolates one wrapper's argv-construction and
 * stdout-parsing without a real repo. `tag-template` / `version` (pure) run
 * for real so `lastTag`'s highest-semver selection is genuinely exercised.
 *
 * The real git round trip — tags actually landing on a repo + bare remote —
 * is covered by tests/integration/tag-plumbing.integration.test.ts and the
 * e2e tier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addForce,
  commitBody,
  commitParents,
  commitWithBody,
  createTag,
  diffNames,
  fetchTagsForce,
  forceTag,
  hasStagedChanges,
  headCommit,
  lastTag,
  pushTag,
  pushTagRef,
  pushTagRefForce,
  tagCommit,
  tagList,
  tagsPointingAtHead,
} from './git.js';
import { execCapture } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';

vi.mock('./utils/exec-error.js', async () => await vi.importActual<typeof import('./utils/exec-error.js')>('./utils/exec-error.js'));

vi.mock('./utils/exec-capture.js');

const execMock = vi.mocked(execCapture);
const OPTS = { cwd: 'repo' };

/** Resolve the seam with the given stdout (stderr empty). */
function stdout(out: string): void {
  execMock.mockResolvedValue({ stdout: out, stderr: '' });
}

/** An ExecError shaped like the one `execCapture` rejects with, carrying git's stderr. */
function gitError(stderr: string): ExecError {
  return new ExecError('Command failed: git', '', stderr, 128);
}

/** Assert git was invoked with exactly this argv (the seam owns encoding/stdio). */
function expectArgv(args: string[]): void {
  expect(execMock).toHaveBeenCalledWith('git', args, expect.objectContaining({ cwd: 'repo' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  execMock.mockResolvedValue({ stdout: '', stderr: '' }); // default: clean, empty-stdout git run
});

describe('headCommit', () => {
  it('returns the current HEAD sha (trimmed)', async () => {
    stdout('abc123\n');
    expect(await headCommit(OPTS)).toBe('abc123');
    expectArgv(['rev-parse', 'HEAD']);
  });
});

describe('commitBody', () => {
  it('returns the raw body of a commit', async () => {
    stdout('subject\n\nline one\nline two\n\nrelease: minor');
    const body = await commitBody('sha', OPTS);
    expect(body).toContain('line one');
    expect(body).toContain('release: minor');
    expectArgv(['log', '-1', '--format=%B', 'sha']);
  });

  it('throws on an unknown sha', async () => {
    execMock.mockRejectedValue(gitError('fatal: bad object abc0123'));
    await expect(commitBody('abc0123', OPTS)).rejects.toThrow();
  });
});

describe('commitParents', () => {
  it('returns one parent for a plain commit', async () => {
    stdout('p1');
    expect(await commitParents('sha', OPTS)).toHaveLength(1);
    expectArgv(['log', '-1', '--format=%P', 'sha']);
  });

  it('returns zero parents for the root commit', async () => {
    stdout('');
    expect(await commitParents('sha', OPTS)).toEqual([]);
  });

  it('returns two parents for a merge commit', async () => {
    stdout('p1 p2');
    const parents = await commitParents('mergesha', OPTS);
    expect(parents).toHaveLength(2);
    expect(parents[1]).toBe('p2');
  });
});

describe('diffNames', () => {
  it('lists files changed between two commits', async () => {
    stdout('b.txt');
    expect(await diffNames('a', 'HEAD', OPTS)).toEqual(['b.txt']);
    expectArgv(['diff', '--name-only', 'a..HEAD']);
  });

  it('returns empty when no changes', async () => {
    stdout('');
    expect(await diffNames('a', 'HEAD', OPTS)).toEqual([]);
  });

  it('handles multi-file commits', async () => {
    stdout('b.txt\ndir/c.txt');
    expect((await diffNames('a', 'HEAD', OPTS)).sort()).toEqual(['b.txt', 'dir/c.txt']);
  });
});

describe('createTag + tagList', () => {
  it('creates an annotated tag pointing at a given sha', async () => {
    await createTag('v0.1.0', 'sha', { cwd: 'repo', message: 'release 0.1.0' });
    expectArgv(['tag', '-a', '-m', 'release 0.1.0', 'v0.1.0', 'sha']);
  });

  it('defaults the annotation message to the tag name', async () => {
    await createTag('v0.1.0', 'sha', OPTS);
    expectArgv(['tag', '-a', '-m', 'v0.1.0', 'v0.1.0', 'sha']);
  });

  it('parses and glob-filters the tag list', async () => {
    stdout('pkg-a-v0.1.0');
    expect(await tagList('pkg-a-*', OPTS)).toEqual(['pkg-a-v0.1.0']);
    expectArgv(['tag', '-l', 'pkg-a-*']);
  });

  it('returns an empty list when no tags match', async () => {
    stdout('');
    expect(await tagList('never-*', OPTS)).toEqual([]);
  });

  it('throws if git rejects the tag creation (e.g. it exists at a different sha)', async () => {
    execMock.mockRejectedValue(gitError("fatal: tag 'v0.1.0' already exists"));
    await expect(createTag('v0.1.0', 'b', OPTS)).rejects.toThrow();
  });
});

describe('lastTag', () => {
  it('finds the highest-semver among pkg-v*.*.* tags (numeric, not lexical)', async () => {
    stdout(['pkg-v0.1.0', 'pkg-v0.1.9', 'pkg-v0.10.0', 'pkg-v0.2.0'].join('\n'));
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.10.0');
    // {version} globs to *.*.* so only semver-shaped candidates are listed.
    expectArgv(['tag', '-l', 'pkg-v*.*.*']);
  });

  it('returns null when no tags for this package exist', async () => {
    stdout('');
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toBeNull();
  });

  it('ignores tags from other packages', async () => {
    stdout('other-v9.9.9\npkg-v0.1.0');
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.1.0');
  });

  it('skips malformed tags under the package prefix', async () => {
    stdout('pkg-v0.1.0\npkg-vnope');
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.1.0');
  });

  it('skips tags matching the glob but rejected by strict semver', async () => {
    // parseSemver rejects leading zeros, exercising the try/catch skip path.
    stdout('pkg-v0.1.0\npkg-v01.02.03');
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.1.0');
  });

  it('honors a custom `v{version}` tag_format for single-package repos', async () => {
    stdout('v0.1.0\nv0.2.11');
    expect(await lastTag('pkg', 'v{version}', OPTS)).toBe('v0.2.11');
    // The `v*.*.*` glob won't match a default-shaped `pkg-v...` tag.
    expectArgv(['tag', '-l', 'v*.*.*']);
  });

  it('compares by major first (higher major wins across differing majors)', async () => {
    // Differing majors exercise the `a.major !== b.major` comparison arm
    // that same-major fixtures never reach.
    execMock.mockResolvedValue({ stdout: 'pkg-v1.9.9\npkg-v2.0.0', stderr: '' });
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v2.0.0');
  });
});

describe('tagCommit', () => {
  it('dereferences a tag to its commit sha (trimmed)', async () => {
    execMock.mockResolvedValue({ stdout: 'deadbeef\n', stderr: '' });
    expect(await tagCommit('lib-v1.0.0', OPTS)).toBe('deadbeef');
    expectArgv(['rev-list', '-n', '1', 'lib-v1.0.0']);
  });

  it('defaults its options bag when called without one', async () => {
    execMock.mockResolvedValue({ stdout: 'cafef00d\n', stderr: '' });
    expect(await tagCommit('lib-v1.0.0')).toBe('cafef00d');
    expect(execMock).toHaveBeenCalledWith(
      'git',
      ['rev-list', '-n', '1', 'lib-v1.0.0'],
      expect.any(Object),
    );
  });
});

describe('pushTag', () => {
  it('pushes to origin by bare name', async () => {
    await pushTag('v0.1.0', OPTS);
    expectArgv(['push', 'origin', 'v0.1.0']);
  });
});

describe('tagCommit', () => {
  it('dereferences a tag to the commit it points at', async () => {
    stdout('deadbeef\n');
    expect(await tagCommit('pkg-v1.0.0', OPTS)).toBe('deadbeef');
    expectArgv(['rev-list', '-n', '1', 'pkg-v1.0.0']);
  });
});

describe('tagsPointingAtHead', () => {
  it('lists the tags whose commit is HEAD', async () => {
    stdout('pkg-v1.0.0\nother-v2.0.0');
    expect((await tagsPointingAtHead(OPTS)).sort()).toEqual(['other-v2.0.0', 'pkg-v1.0.0']);
    expectArgv(['tag', '--points-at', 'HEAD']);
  });

  it('returns empty when HEAD carries no tag', async () => {
    stdout('');
    expect(await tagsPointingAtHead(OPTS)).toEqual([]);
  });
});

describe('pushTagRef', () => {
  it('pushes a single tag ref-scoped and is idempotent', async () => {
    await pushTagRef('pkg-v1.0.0', OPTS);
    expectArgv(['push', 'origin', 'refs/tags/pkg-v1.0.0']);
    // A second push of the same ref is a clean no-op, not an error.
    await expect(pushTagRef('pkg-v1.0.0', OPTS)).resolves.toBeUndefined();
  });

  it('fails loudly when the remote holds the tag at a different commit', async () => {
    execMock.mockRejectedValue(gitError('! [rejected] pkg-v1.0.0 -> pkg-v1.0.0 (non-fast-forward)'));
    await expect(pushTagRef('pkg-v1.0.0', OPTS)).rejects.toThrow();
  });
});

describe('forceTag + pushTagRefForce + fetchTagsForce (floating-tag move; #446)', () => {
  it('forceTag creates or moves a lightweight tag', async () => {
    await forceTag('v0', 'a', OPTS);
    expectArgv(['tag', '-f', 'v0', 'a']);
  });

  it('pushTagRefForce force-publishes the moved tag ref-scoped', async () => {
    await pushTagRefForce('v0', OPTS);
    expectArgv(['push', '--force', 'origin', 'refs/tags/v0']);
  });

  it('fetchTagsForce refreshes remote tags with --force', async () => {
    await fetchTagsForce(OPTS);
    expectArgv(['fetch', '--tags', '--force', 'origin']);
  });
});

describe('addForce + hasStagedChanges + commitWithBody (fold; #446)', () => {
  it('addForce stages a pathspec overriding .gitignore', async () => {
    await addForce('dist-action/', OPTS);
    expectArgv(['add', '-f', 'dist-action/']);
  });

  it('hasStagedChanges is false on a clean index and true when the quiet diff exits non-zero', async () => {
    stdout(''); // `git diff --cached --quiet` exits 0
    expect(await hasStagedChanges(OPTS)).toBe(false);
    expectArgv(['diff', '--cached', '--quiet']);

    execMock.mockRejectedValue(gitError('')); // non-zero exit => staged changes present
    expect(await hasStagedChanges(OPTS)).toBe(true);
  });

  it('commitWithBody forwards subject + body as two -m paragraphs', async () => {
    await commitWithBody('chore(release): bundle action', 'parent subject\n\nrelease: minor', OPTS);
    expectArgv([
      'commit',
      '-m',
      'chore(release): bundle action',
      '-m',
      'parent subject\n\nrelease: minor',
    ]);
  });
});

describe('error surfacing', () => {
  it('folds git stderr into the thrown error', async () => {
    execMock.mockRejectedValue(gitError("fatal: bad revision 'nonexistent-sha-zzz'"));
    await expect(diffNames('nonexistent-sha-zzz', 'HEAD', OPTS)).rejects.toThrow(
      /nonexistent-sha-zzz|bad|unknown|revision/i,
    );
  });

  it('throws when git itself fails (e.g. run outside a repo)', async () => {
    execMock.mockRejectedValue(gitError('fatal: not a git repository'));
    await expect(headCommit(OPTS)).rejects.toThrow();
  });

  it('trims surrounding whitespace off the folded git stderr', async () => {
    // The stderr is `.trim()`-ed before folding, so padding around git's
    // output never leaks into the message. Pins the trim: the folded line
    // ends exactly at `boom`, with no trailing newline or spaces.
    execMock.mockRejectedValue(gitError('\n   fatal: boom   \n'));
    let caught: unknown;
    try {
      await headCommit(OPTS);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toMatch(/\nfatal: boom$/);
  });

  it('surfaces the bare error message when the rejection carries no ExecError stderr', async () => {
    // A non-ExecError rejection (no `.stderr`) folds to just the base message.
    execMock.mockRejectedValue(new Error('spawn git ENOMEM'));
    await expect(headCommit(OPTS)).rejects.toThrow('spawn git ENOMEM');
  });

  it('stringifies a non-Error rejection into the thrown message', async () => {
    // A rejection that is neither an ExecError nor an Error (a bare
    // string) has no `.message`; `run` folds it via `String(err)` so the
    // thrown message still carries the root cause.
    execMock.mockRejectedValue('git blew up: bare string reason');
    await expect(headCommit(OPTS)).rejects.toThrow('git blew up: bare string reason');
  });

  it('gives an actionable hint when no committer identity is configured (#206)', async () => {
    execMock.mockRejectedValue(
      gitError('*** Please tell me who you are.\nunable to auto-detect email address'),
    );
    await expect(createTag('v0.1.0', 'sha', OPTS)).rejects.toThrow(
      /no committer identity configured/,
    );
  });

  it('names the failing git subcommand (args[0]) in the identity hint', async () => {
    // The wrappers' argv is typed `readonly [string, ...string[]]`, so
    // `args[0]` is always a `string` — the hint interpolates it directly
    // with no `?? ''` fallback. `createTag` runs `git tag …`, so the
    // message must lead with `git tag:`, proving the first arg flows
    // through verbatim.
    execMock.mockRejectedValue(
      gitError('*** Please tell me who you are.\nunable to auto-detect email address'),
    );
    await expect(createTag('v0.1.0', 'sha', OPTS)).rejects.toThrow('git tag:');
  });
});
