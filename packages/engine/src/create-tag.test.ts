import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTag } from './create-tag.js';
import { runGit } from './run-git.js';

vi.mock('./run-git.js');

const runGitMock = vi.mocked(runGit);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createTag', () => {
  it('creates an annotated tag pointing at a given sha', async () => {
    const opts = { cwd: 'repo', message: 'release 0.1.0' };
    await createTag('v0.1.0', 'sha', opts);
    expect(runGitMock).toHaveBeenCalledWith(['tag', '-a', '-m', 'release 0.1.0', 'v0.1.0', 'sha'], opts);
  });

  it('defaults the annotation message to the tag name', async () => {
    await createTag('v0.1.0', 'sha');
    expect(runGitMock).toHaveBeenCalledWith(['tag', '-a', '-m', 'v0.1.0', 'v0.1.0', 'sha'], {});
  });

  it('throws if git rejects the tag creation (e.g. it exists at a different sha)', async () => {
    runGitMock.mockRejectedValue(new Error("fatal: tag 'v0.1.0' already exists"));
    await expect(createTag('v0.1.0', 'b', { cwd: 'repo' })).rejects.toThrow("fatal: tag 'v0.1.0' already exists");
  });
});
