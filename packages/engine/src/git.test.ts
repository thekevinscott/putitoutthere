/**
 * Git wrapper tests (#9). The file under test is `git.ts`; its only
 * collaborator is the `git` CLI via `execFileSync`, mocked here so each case
 * isolates one wrapper's argv-construction and stdout-parsing without a real
 * repo. `tag-template` / `version` (pure) run for real so `lastTag`'s
 * highest-semver selection is genuinely exercised.
 *
 * The real git round trip — tags actually landing on a repo + bare remote —
 * is covered by test/integration/tag-plumbing.integration.test.ts and the
 * e2e tier.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  tagList,
  tagsPointingAtHead,
} from './git.js';

vi.mock('node:child_process');

const execMock = vi.mocked(execFileSync);
const OPTS = { cwd: 'repo' };

/** An error shaped like the one `execFileSync` throws, carrying git's stderr. */
function gitError(stderr: string): Error {
  return Object.assign(new Error('Command failed: git'), { stderr: Buffer.from(stderr) });
}

/** Assert git was invoked with exactly this argv (ignoring the options bag). */
function expectArgv(args: string[]): void {
  expect(execMock).toHaveBeenCalledWith('git', args, expect.objectContaining({ cwd: 'repo' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  execMock.mockReturnValue(''); // default: a clean, empty-stdout git run
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headCommit', () => {
  it('returns the current HEAD sha (trimmed)', () => {
    execMock.mockReturnValue('abc123\n');
    expect(headCommit(OPTS)).toBe('abc123');
    expectArgv(['rev-parse', 'HEAD']);
  });
});

describe('commitBody', () => {
  it('returns the raw body of a commit', () => {
    execMock.mockReturnValue('subject\n\nline one\nline two\n\nrelease: minor');
    const body = commitBody('sha', OPTS);
    expect(body).toContain('line one');
    expect(body).toContain('release: minor');
    expectArgv(['log', '-1', '--format=%B', 'sha']);
  });

  it('throws on an unknown sha', () => {
    execMock.mockImplementation(() => {
      throw gitError("fatal: bad object abc0123");
    });
    expect(() => commitBody('abc0123', OPTS)).toThrow();
  });
});

describe('commitParents', () => {
  it('returns one parent for a plain commit', () => {
    execMock.mockReturnValue('p1');
    expect(commitParents('sha', OPTS)).toHaveLength(1);
    expectArgv(['log', '-1', '--format=%P', 'sha']);
  });

  it('returns zero parents for the root commit', () => {
    execMock.mockReturnValue('');
    expect(commitParents('sha', OPTS)).toEqual([]);
  });

  it('returns two parents for a merge commit', () => {
    execMock.mockReturnValue('p1 p2');
    const parents = commitParents('mergesha', OPTS);
    expect(parents).toHaveLength(2);
    expect(parents[1]).toBe('p2');
  });
});

describe('diffNames', () => {
  it('lists files changed between two commits', () => {
    execMock.mockReturnValue('b.txt');
    expect(diffNames('a', 'HEAD', OPTS)).toEqual(['b.txt']);
    expectArgv(['diff', '--name-only', 'a..HEAD']);
  });

  it('returns empty when no changes', () => {
    execMock.mockReturnValue('');
    expect(diffNames('a', 'HEAD', OPTS)).toEqual([]);
  });

  it('handles multi-file commits', () => {
    execMock.mockReturnValue('b.txt\ndir/c.txt');
    expect(diffNames('a', 'HEAD', OPTS).sort()).toEqual(['b.txt', 'dir/c.txt']);
  });
});

describe('createTag + tagList', () => {
  it('creates an annotated tag pointing at a given sha', () => {
    createTag('v0.1.0', 'sha', { cwd: 'repo', message: 'release 0.1.0' });
    expectArgv(['tag', '-a', '-m', 'release 0.1.0', 'v0.1.0', 'sha']);
  });

  it('defaults the annotation message to the tag name', () => {
    createTag('v0.1.0', 'sha', OPTS);
    expectArgv(['tag', '-a', '-m', 'v0.1.0', 'v0.1.0', 'sha']);
  });

  it('parses and glob-filters the tag list', () => {
    execMock.mockReturnValue('pkg-a-v0.1.0');
    expect(tagList('pkg-a-*', OPTS)).toEqual(['pkg-a-v0.1.0']);
    expectArgv(['tag', '-l', 'pkg-a-*']);
  });

  it('returns an empty list when no tags match', () => {
    execMock.mockReturnValue('');
    expect(tagList('never-*', OPTS)).toEqual([]);
  });

  it('throws if git rejects the tag creation (e.g. it exists at a different sha)', () => {
    execMock.mockImplementation(() => {
      throw gitError("fatal: tag 'v0.1.0' already exists");
    });
    expect(() => createTag('v0.1.0', 'b', OPTS)).toThrow();
  });
});

describe('lastTag', () => {
  it('finds the highest-semver among pkg-v*.*.* tags (numeric, not lexical)', () => {
    execMock.mockReturnValue(['pkg-v0.1.0', 'pkg-v0.1.9', 'pkg-v0.10.0', 'pkg-v0.2.0'].join('\n'));
    expect(lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.10.0');
    // {version} globs to *.*.* so only semver-shaped candidates are listed.
    expectArgv(['tag', '-l', 'pkg-v*.*.*']);
  });

  it('returns null when no tags for this package exist', () => {
    execMock.mockReturnValue('');
    expect(lastTag('pkg', '{name}-v{version}', OPTS)).toBeNull();
  });

  it('ignores tags from other packages', () => {
    execMock.mockReturnValue('other-v9.9.9\npkg-v0.1.0');
    expect(lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.1.0');
  });

  it('skips malformed tags under the package prefix', () => {
    execMock.mockReturnValue('pkg-v0.1.0\npkg-vnope');
    expect(lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.1.0');
  });

  it('skips tags matching the glob but rejected by strict semver', () => {
    // parseSemver rejects leading zeros, exercising the try/catch skip path.
    execMock.mockReturnValue('pkg-v0.1.0\npkg-v01.02.03');
    expect(lastTag('pkg', '{name}-v{version}', OPTS)).toBe('pkg-v0.1.0');
  });

  it('honors a custom `v{version}` tag_format for single-package repos', () => {
    execMock.mockReturnValue('v0.1.0\nv0.2.11');
    expect(lastTag('pkg', 'v{version}', OPTS)).toBe('v0.2.11');
    // The `v*.*.*` glob won't match a default-shaped `pkg-v...` tag.
    expectArgv(['tag', '-l', 'v*.*.*']);
  });
});

describe('pushTag', () => {
  it('pushes to origin by bare name', () => {
    pushTag('v0.1.0', OPTS);
    expectArgv(['push', 'origin', 'v0.1.0']);
  });
});

describe('tagsPointingAtHead', () => {
  it('lists the tags whose commit is HEAD', () => {
    execMock.mockReturnValue('pkg-v1.0.0\nother-v2.0.0');
    expect(tagsPointingAtHead(OPTS).sort()).toEqual(['other-v2.0.0', 'pkg-v1.0.0']);
    expectArgv(['tag', '--points-at', 'HEAD']);
  });

  it('returns empty when HEAD carries no tag', () => {
    execMock.mockReturnValue('');
    expect(tagsPointingAtHead(OPTS)).toEqual([]);
  });
});

describe('pushTagRef', () => {
  it('pushes a single tag ref-scoped and is idempotent', () => {
    pushTagRef('pkg-v1.0.0', OPTS);
    expectArgv(['push', 'origin', 'refs/tags/pkg-v1.0.0']);
    // A second push of the same ref is a clean no-op, not an error.
    expect(() => pushTagRef('pkg-v1.0.0', OPTS)).not.toThrow();
  });

  it('fails loudly when the remote holds the tag at a different commit', () => {
    execMock.mockImplementation(() => {
      throw gitError('! [rejected] pkg-v1.0.0 -> pkg-v1.0.0 (non-fast-forward)');
    });
    expect(() => pushTagRef('pkg-v1.0.0', OPTS)).toThrow();
  });
});

describe('forceTag + pushTagRefForce + fetchTagsForce (floating-tag move; #446)', () => {
  it('forceTag creates or moves a lightweight tag', () => {
    forceTag('v0', 'a', OPTS);
    expectArgv(['tag', '-f', 'v0', 'a']);
  });

  it('pushTagRefForce force-publishes the moved tag ref-scoped', () => {
    pushTagRefForce('v0', OPTS);
    expectArgv(['push', '--force', 'origin', 'refs/tags/v0']);
  });

  it('fetchTagsForce refreshes remote tags with --force', () => {
    fetchTagsForce(OPTS);
    expectArgv(['fetch', '--tags', '--force', 'origin']);
  });
});

describe('addForce + hasStagedChanges + commitWithBody (fold; #446)', () => {
  it('addForce stages a pathspec overriding .gitignore', () => {
    addForce('dist-action/', OPTS);
    expectArgv(['add', '-f', 'dist-action/']);
  });

  it('hasStagedChanges is false on a clean index and true when the quiet diff exits non-zero', () => {
    execMock.mockReturnValue(''); // `git diff --cached --quiet` exits 0
    expect(hasStagedChanges(OPTS)).toBe(false);
    expectArgv(['diff', '--cached', '--quiet']);

    execMock.mockImplementation(() => {
      throw gitError(''); // non-zero exit => staged changes present
    });
    expect(hasStagedChanges(OPTS)).toBe(true);
  });

  it('commitWithBody forwards subject + body as two -m paragraphs', () => {
    commitWithBody('chore(release): bundle action', 'parent subject\n\nrelease: minor', OPTS);
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
  it('folds git stderr into the thrown error', () => {
    execMock.mockImplementation(() => {
      throw gitError("fatal: bad revision 'nonexistent-sha-zzz'");
    });
    expect(() => diffNames('nonexistent-sha-zzz', 'HEAD', OPTS)).toThrow(
      /nonexistent-sha-zzz|bad|unknown|revision/i,
    );
  });

  it('throws when git itself fails (e.g. run outside a repo)', () => {
    execMock.mockImplementation(() => {
      throw gitError('fatal: not a git repository');
    });
    expect(() => headCommit(OPTS)).toThrow();
  });
});
