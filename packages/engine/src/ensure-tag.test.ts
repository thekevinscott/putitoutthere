/**
 * `ensureTag` — auto-heal a missing release tag (#407), fixed for #717:
 * idempotency reads the remote, and a failed push throws instead of warning.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureTag } from './ensure-tag.js';
import { createTag, pushTag, remoteTagExists, tagList } from './git.js';
import type { Logger } from './types.js';

vi.mock('./git.js');

const tagListMock = vi.mocked(tagList);
const createTagMock = vi.mocked(createTag);
const pushTagMock = vi.mocked(pushTag);
const remoteTagExistsMock = vi.mocked(remoteTagExists);

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ensureTag', () => {
  it('creates and pushes the tag when neither origin nor the local repo has it', async () => {
    remoteTagExistsMock.mockResolvedValue(false);
    tagListMock.mockResolvedValue([]); // tag absent locally
    const log = makeLog();

    await ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(createTagMock).toHaveBeenCalledWith('lib-v1.0.0', 'headsha', {
      cwd: 'repo',
      message: 'Release lib-v1.0.0',
    });
    expect(pushTagMock).toHaveBeenCalledWith('lib-v1.0.0', { cwd: 'repo' });
  });

  it('is a no-op when origin already has the tag', async () => {
    remoteTagExistsMock.mockResolvedValue(true);
    const log = makeLog();

    await ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(tagListMock).not.toHaveBeenCalled();
    expect(createTagMock).not.toHaveBeenCalled();
    expect(pushTagMock).not.toHaveBeenCalled();
  });

  it('retries the push, without recreating the tag, when a local tag survived a prior failed push (#717)', async () => {
    // Exactly the state a half-failed earlier run leaves behind: the local
    // tag exists (created last time), but origin never got it (the push
    // that followed failed). A local-only check reads this as "already
    // done" and never tries again — the bug this test pins.
    remoteTagExistsMock.mockResolvedValue(false);
    tagListMock.mockResolvedValue(['lib-v1.0.0']); // tag present locally only
    const log = makeLog();

    await ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log);

    expect(createTagMock).not.toHaveBeenCalled();
    expect(pushTagMock).toHaveBeenCalledWith('lib-v1.0.0', { cwd: 'repo' });
  });

  it('throws instead of swallowing a failed push into a warning (#717)', async () => {
    remoteTagExistsMock.mockResolvedValue(false);
    tagListMock.mockResolvedValue([]);
    pushTagMock.mockRejectedValue(new Error('No configured push destination'));
    const log = makeLog();

    await expect(
      ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log),
    ).rejects.toThrow(/PIOT_TAG_PUSH_FAILED.*lib@1\.0\.0.*No configured push destination/s);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error push rejection in the thrown message', async () => {
    remoteTagExistsMock.mockResolvedValue(false);
    tagListMock.mockResolvedValue([]);
    // A rejection that is not an Error (a bare string) has no `.message`;
    // ensureTag folds it via `String(err)` into the thrown error text.
    pushTagMock.mockRejectedValue('push blew up: bare string reason');
    const log = makeLog();

    await expect(
      ensureTag('{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log),
    ).rejects.toThrow(/push blew up: bare string reason/);
  });

  it('attaches the original rejection as the thrown error\'s cause', async () => {
    remoteTagExistsMock.mockResolvedValue(false);
    tagListMock.mockResolvedValue([]);
    const original = new Error('fatal: unable to access origin');
    pushTagMock.mockRejectedValue(original);
    const log = makeLog();

    const err: unknown = await ensureTag(
      '{name}-v{version}', 'lib', '1.0.0', 'headsha', { cwd: 'repo' }, log,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBe(original);
  });
});
