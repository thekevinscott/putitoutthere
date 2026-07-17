/**
 * `foldActionBundle` — synthesize the action-bundle commit (#446). The git
 * primitives (`./git.js`) are mocked so this isolates the fold orchestration:
 * stage the bundle → guard on an empty index → forward the parent body into the
 * bundle commit. The real git round trip is covered at the integration + e2e
 * tiers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { foldActionBundle } from './fold-action-bundle.js';
import { addForce, commitBody, commitWithBody, hasStagedChanges } from './git.js';

// Automock (no factory): the git-primitive doubles are generated from the real
// module so they can't drift from the source, satisfying unit isolation without
// a hand-written (untyped) factory.
vi.mock('./git.js');

const addForceMock = vi.mocked(addForce);
const commitBodyMock = vi.mocked(commitBody);
const commitWithBodyMock = vi.mocked(commitWithBody);
const hasStagedChangesMock = vi.mocked(hasStagedChanges);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('foldActionBundle', () => {
  it('commits the staged bundle on top of HEAD, forwarding the parent body', async () => {
    hasStagedChangesMock.mockResolvedValue(true);
    commitBodyMock.mockResolvedValue('feat: bump\n\nrelease: minor');

    const code = await foldActionBundle({ cwd: '/repo', subject: 'chore(v0): bundle action' });

    expect(code).toBe(0);
    // Stages the freshly-built bundle dir before committing.
    expect(addForceMock).toHaveBeenCalledWith('dist-action/', { cwd: '/repo' });
    // The parent's full body (with its `release:` trailer) is read from HEAD and
    // forwarded verbatim into the bundle commit, so the publish-time plan
    // re-derivation keeps the operator's bump instead of defaulting to patch.
    expect(commitBodyMock).toHaveBeenCalledWith('HEAD', { cwd: '/repo' });
    expect(commitWithBodyMock).toHaveBeenCalledWith(
      'chore(v0): bundle action',
      'feat: bump\n\nrelease: minor',
      { cwd: '/repo' },
    );
  });

  it('throws the guard message when nothing is staged to fold', async () => {
    // Empty index after staging: `build:action` produced nothing, an unexpected
    // state the release must abort on rather than commit nothing.
    hasStagedChangesMock.mockResolvedValue(false);

    await expect(
      foldActionBundle({ cwd: '/repo', subject: 'chore(release): bundle action' }),
    ).rejects.toThrow(
      'No bundle changes to commit (unexpected — build:action should have produced output).',
    );
    // The guard fires before any commit is attempted.
    expect(commitWithBodyMock).not.toHaveBeenCalled();
  });
});
