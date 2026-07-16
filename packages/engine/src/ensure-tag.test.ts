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
  it('creates the missing tag and warns when the push fails', () => {
    tagListMock.mockReturnValue([]); // tag absent
    pushTagMock.mockImplementation(() => {
      // A repo with no `origin` (the heal running before a remote exists)
      // fails the push; ensureTag swallows it into a warning.
      throw new Error('No configured push destination');
    });
    const log = makeLog();

    ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(createTagMock).toHaveBeenCalledWith('lib-v1.0.0', 'headsha', {
      cwd: 'repo',
      message: 'Release lib-v1.0.0',
    });
    expect(pushTagMock).toHaveBeenCalledWith('lib-v1.0.0', { cwd: 'repo' });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('warns with String(err) when the push throws a non-Error', () => {
    tagListMock.mockReturnValue([]); // tag absent
    pushTagMock.mockImplementation(() => {
      // A non-Error rejection (a bare string) exercises the `: String(err)`
      // arm of the warning's message interpolation.
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error to hit the String(err) branch
      throw 'push exploded';
    });
    const log = makeLog();

    ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('push exploded'));
  });

  it('is a no-op when the tag already exists', () => {
    tagListMock.mockReturnValue(['lib-v1.0.0']); // tag present
    const log = makeLog();

    ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    // We neither re-created nor tried to push it.
    expect(createTagMock).not.toHaveBeenCalled();
    expect(pushTagMock).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
