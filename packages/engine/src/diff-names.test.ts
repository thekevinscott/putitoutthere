import { beforeEach, describe, expect, it, vi } from 'vitest';

import { diffNames } from './diff-names.js';
import { runGit } from './run-git.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);
const OPTS = { cwd: 'repo' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('diffNames', () => {
  it('lists files changed between two commits', async () => {
    runGitMock.mockResolvedValue('b.txt');
    expect(await diffNames('a', 'HEAD', OPTS)).toEqual(['b.txt']);
    expect(runGitMock).toHaveBeenCalledWith(['diff', '--name-only', 'a..HEAD'], OPTS);
  });

  it('returns empty when no changes', async () => {
    runGitMock.mockResolvedValue('');
    expect(await diffNames('a', 'HEAD', OPTS)).toEqual([]);
  });

  it('handles multi-file commits, dropping blank lines', async () => {
    runGitMock.mockResolvedValue('b.txt\n\ndir/c.txt');
    expect(await diffNames('a', 'HEAD', OPTS)).toEqual(['b.txt', 'dir/c.txt']);
  });

  it('defaults its options bag when called without one', async () => {
    runGitMock.mockResolvedValue('');
    await diffNames('a', 'HEAD');
    expect(runGitMock).toHaveBeenCalledWith(['diff', '--name-only', 'a..HEAD'], {});
  });
});
