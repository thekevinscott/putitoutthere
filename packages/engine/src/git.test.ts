/**
 * Git wrapper tests (#9).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addForce,
  commitBody,
  commitParents,
  commitWithBody,
  fetchTagsForce,
  forceTag,
  headCommit,
  pushTag,
  pushTagRef,
  pushTagRefForce,
  tagCommit,
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

describe('addForce + commitWithBody (fold; #446)', () => {
  it('addForce stages a pathspec overriding .gitignore', async () => {
    await addForce('dist-action/', OPTS);
    expectArgv(['add', '-f', 'dist-action/']);
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
