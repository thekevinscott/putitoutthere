/**
 * `ensureTag` — auto-heal a missing release tag (#407).
 *
 * The git collaborators (`tagList`, `createTag`, `pushTag`) are mocked so
 * this isolates the exists-check / create / warn-on-push-failure branches;
 * `formatTag` (pure) runs for real. The real git round trip — the tag
 * actually landing — is covered by
 * tests/integration/tag-plumbing.integration.test.ts and the e2e tier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureTag } from './ensure-tag.js';
import { createTag, pushTag, tagList } from './git.js';
import type { Logger } from './types.js';

vi.mock('./git.js');

const tagListMock = vi.mocked(tagList);
const createTagMock = vi.mocked(createTag);
const pushTagMock = vi.mocked(pushTag);

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ensureTag', () => {
  it('creates the missing tag and warns when the push fails', async () => {
    tagListMock.mockResolvedValue([]); // tag absent
    pushTagMock.mockRejectedValue(
      // A repo with no `origin` (the heal running before a remote exists)
      // fails the push; ensureTag swallows it into a warning.
      new Error('No configured push destination'),
    );
    const log = makeLog();

    await ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(createTagMock).toHaveBeenCalledWith('lib-v1.0.0', 'headsha', {
      cwd: 'repo',
      message: 'Release lib-v1.0.0',
    });
    expect(pushTagMock).toHaveBeenCalledWith('lib-v1.0.0', { cwd: 'repo' });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('stringifies a non-Error push rejection in the warning', async () => {
    tagListMock.mockResolvedValue([]); // tag absent
    // A rejection that is not an Error (a bare string) has no `.message`;
    // ensureTag folds it via `String(err)` into the warning text.
    pushTagMock.mockRejectedValue('push blew up: bare string reason');
    const log = makeLog();

    await ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('push blew up: bare string reason'),
    );
  });

  it('is a no-op when the tag already exists', async () => {
    tagListMock.mockResolvedValue(['lib-v1.0.0']); // tag present
    const log = makeLog();

    await ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    // We neither re-created nor tried to push it.
    expect(createTagMock).not.toHaveBeenCalled();
    expect(pushTagMock).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
