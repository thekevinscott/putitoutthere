/**
 * `forceMoveTag` — the shared local-write + ref-scoped force-push both
 * floating-tag advancers use (#446).
 *
 * The git collaborators (`forceTag`, `pushTagRefForce`) are mocked so this
 * isolates the delegation contract — the local move then the ref-scoped
 * force-push, in that order. The real git + bare-remote round trip (the tag
 * actually overwriting a diverged remote) is covered by
 * tests/integration/tag-plumbing.integration.test.ts and the e2e tier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forceMoveTag } from './force-move-tag.js';
import { forceTag, pushTagRefForce } from './git.js';

vi.mock('./git.js');

const forceTagMock = vi.mocked(forceTag);
const pushForceMock = vi.mocked(pushTagRefForce);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('forceMoveTag', () => {
  it('writes the tag locally then force-pushes it ref-scoped to the remote', () => {
    forceMoveTag('v0', 'headsha', { cwd: 'repo' });

    expect(forceTagMock).toHaveBeenCalledWith('v0', 'headsha', { cwd: 'repo' });
    expect(pushForceMock).toHaveBeenCalledWith('v0', { cwd: 'repo' });
    // Local move must precede the publish so the remote never leads local.
    expect(forceTagMock.mock.invocationCallOrder[0]!).toBeLessThan(
      pushForceMock.mock.invocationCallOrder[0]!,
    );
  });

  it('re-targets the tag on a subsequent move (the force path)', () => {
    forceMoveTag('v0', 'first', { cwd: 'repo' });
    forceMoveTag('v0', 'second', { cwd: 'repo' });

    // The second move points both the local write and the forced push at the
    // new commit — the diverged-remote overwrite the force flag exists for.
    expect(forceTagMock).toHaveBeenLastCalledWith('v0', 'second', { cwd: 'repo' });
    expect(pushForceMock).toHaveBeenCalledTimes(2);
  });
});
