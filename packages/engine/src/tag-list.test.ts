import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGit } from './run-git.js';
import { tagList } from './tag-list.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);
const OPTS = { cwd: 'repo' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('tagList', () => {
  it('parses and glob-filters the tag list', async () => {
    runGitMock.mockResolvedValue('pkg-a-v0.1.0\n\npkg-a-v0.2.0');
    expect(await tagList('pkg-a-*', OPTS)).toEqual(['pkg-a-v0.1.0', 'pkg-a-v0.2.0']);
    expect(runGitMock).toHaveBeenCalledWith(['tag', '-l', 'pkg-a-*'], OPTS);
  });

  it('returns an empty list when no tags match', async () => {
    runGitMock.mockResolvedValue('');
    expect(await tagList('never-*', OPTS)).toEqual([]);
  });

  it('defaults its options bag when called without one', async () => {
    runGitMock.mockResolvedValue('');
    await tagList('never-*');
    expect(runGitMock).toHaveBeenCalledWith(['tag', '-l', 'never-*'], {});
  });
});
