import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasStagedChanges } from './has-staged-changes.js';
import { runGit } from './run-git.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('hasStagedChanges', () => {
  it('is false on a clean index', async () => {
    runGitMock.mockResolvedValue('');
    expect(await hasStagedChanges({ cwd: 'repo' })).toBe(false);
    expect(runGitMock).toHaveBeenCalledWith(['diff', '--cached', '--quiet'], { cwd: 'repo' });
  });

  it('is true when the quiet diff exits non-zero', async () => {
    runGitMock.mockRejectedValue(new Error('exit 1'));
    expect(await hasStagedChanges()).toBe(true);
    expect(runGitMock).toHaveBeenCalledWith(['diff', '--cached', '--quiet'], {});
  });
});
