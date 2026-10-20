import { beforeEach, describe, expect, it, vi } from 'vitest';

import { remoteTagExists } from './remote-tag-exists.js';
import { runGit } from './run-git.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);
const OPTS = { cwd: 'repo' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('remoteTagExists', () => {
  it('is true when ls-remote reports a matching ref', async () => {
    runGitMock.mockResolvedValue('a1b2c3d\trefs/tags/lib-v1.0.0');
    expect(await remoteTagExists('lib-v1.0.0', OPTS)).toBe(true);
    expect(runGitMock).toHaveBeenCalledWith(['ls-remote', '--tags', 'origin', 'refs/tags/lib-v1.0.0'], OPTS);
  });

  it('is false when ls-remote reports no matching ref', async () => {
    runGitMock.mockResolvedValue('');
    expect(await remoteTagExists('lib-v1.0.0')).toBe(false);
    expect(runGitMock).toHaveBeenCalledWith(['ls-remote', '--tags', 'origin', 'refs/tags/lib-v1.0.0'], {});
  });

  it('throws when the remote cannot be reached at all (e.g. no origin configured)', async () => {
    runGitMock.mockRejectedValue(new Error("fatal: 'origin' does not appear to be a git repository"));
    await expect(remoteTagExists('lib-v1.0.0', OPTS)).rejects.toThrow(
      "fatal: 'origin' does not appear to be a git repository",
    );
  });
});
