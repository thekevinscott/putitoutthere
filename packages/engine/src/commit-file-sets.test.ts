import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitFileSets } from './commit-file-sets.js';
import { runGit } from './run-git.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('commitFileSets', () => {
  it('lists the commits after the base, one file set per commit', async () => {
    runGitMock.mockResolvedValue('\x1e\n\na/one.ts\na/two.ts\n\x1e\n\nb/three.ts');

    expect(await commitFileSets('lib-v1.0.0', { cwd: 'repo' })).toEqual([
      ['a/one.ts', 'a/two.ts'],
      ['b/three.ts'],
    ]);
    expect(runGitMock).toHaveBeenCalledWith(
      ['log', '--format=%x1e', '--name-only', 'lib-v1.0.0..HEAD'],
      { cwd: 'repo' },
    );
  });

  it('walks the whole history when there is no base', async () => {
    runGitMock.mockResolvedValue('\x1e\n\na.ts');

    expect(await commitFileSets(null, { cwd: 'repo' })).toEqual([['a.ts']]);
    expect(runGitMock).toHaveBeenCalledWith(
      ['log', '--format=%x1e', '--name-only', 'HEAD'],
      { cwd: 'repo' },
    );
  });

  it('keeps a commit that touched no files as an empty set', async () => {
    runGitMock.mockResolvedValue('\x1e\n\x1e\n\na.ts');

    expect(await commitFileSets(null)).toEqual([[], ['a.ts']]);
  });

  it('returns no sets when the range is empty', async () => {
    runGitMock.mockResolvedValue('');

    expect(await commitFileSets('lib-v1.0.0')).toEqual([]);
  });
});
