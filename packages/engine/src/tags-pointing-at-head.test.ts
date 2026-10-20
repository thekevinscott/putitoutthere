import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGit } from './run-git.js';
import { tagsPointingAtHead } from './tags-pointing-at-head.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);
const OPTS = { cwd: 'repo' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('tagsPointingAtHead', () => {
  it('lists the tags whose commit is HEAD', async () => {
    runGitMock.mockResolvedValue('pkg-v1.0.0\n\nother-v2.0.0');
    expect(await tagsPointingAtHead(OPTS)).toEqual(['pkg-v1.0.0', 'other-v2.0.0']);
    expect(runGitMock).toHaveBeenCalledWith(['tag', '--points-at', 'HEAD'], OPTS);
  });

  it('returns empty when HEAD carries no tag', async () => {
    runGitMock.mockResolvedValue('');
    expect(await tagsPointingAtHead(OPTS)).toEqual([]);
  });

  it('defaults its options bag when called without one', async () => {
    runGitMock.mockResolvedValue('');
    await tagsPointingAtHead();
    expect(runGitMock).toHaveBeenCalledWith(['tag', '--points-at', 'HEAD'], {});
  });
});
