import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitFileSets } from './commit-file-sets.js';
import type { Package } from './config.js';
import { ensureTag } from './ensure-tag.js';
import { lastTag, remoteTagExists, tagList } from './git.js';
import { healPublishedTag } from './heal-published-tag.js';
import type { Logger } from './types.js';

vi.mock('./git.js');
vi.mock('./commit-file-sets.js');
vi.mock('./ensure-tag.js');

const remoteTagExistsMock = vi.mocked(remoteTagExists);
const tagListMock = vi.mocked(tagList);
const lastTagMock = vi.mocked(lastTag);
const commitFileSetsMock = vi.mocked(commitFileSets);
const ensureTagMock = vi.mocked(ensureTag);

const lib = { name: 'lib', kind: 'npm', path: 'lib', globs: ['lib/**'], depends_on: [], tag_format: '{name}-v{version}' } as unknown as Package;
const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const opts = { cwd: 'repo' };

beforeEach(() => {
  vi.resetAllMocks();
  remoteTagExistsMock.mockResolvedValue(false);
  tagListMock.mockResolvedValue([]);
  lastTagMock.mockResolvedValue({ tag: 'lib-v1.0.0', version: { major: 1, minor: 0, patch: 0 } });
});

describe('healPublishedTag', () => {
  it('tags HEAD when a single commit since the last tag touches the package', async () => {
    commitFileSetsMock.mockResolvedValue([['lib/a.ts'], ['other/b.ts']]);

    await healPublishedTag(lib, [lib], '1.0.1', 'headsha', opts, log);

    expect(commitFileSetsMock).toHaveBeenCalledWith('lib-v1.0.0', opts);
    expect(ensureTagMock).toHaveBeenCalledWith('{name}-v{version}', 'lib', '1.0.1', 'headsha', opts, log);
  });

  it('refuses to tag HEAD when two commits since the last tag touch the package', async () => {
    commitFileSetsMock.mockResolvedValue([['lib/a.ts'], ['lib/b.ts']]);

    const run = healPublishedTag(lib, [lib], '1.0.1', 'headsha', opts, log);

    await expect(run).rejects.toThrow(
      '[PIOT_HEAL_UNRELEASED_CHANGES] lib@1.0.1 is live on the registry but untagged, and HEAD has ' +
        'unreleased changes: 2 commits since lib-v1.0.0 touch lib, so the published commit cannot be told ' +
        'apart from later ones, and tagging HEAD would mark unreleased code as 1.0.1. Tag the commit that ' +
        'was actually published, by hand (`git tag -a lib-v1.0.1 <sha> && git push origin lib-v1.0.1`) or ' +
        'by running `putitoutthere reconcile --expect lib@1.0.1` from a checkout of that commit, then rerun.',
    );
    expect(ensureTagMock).not.toHaveBeenCalled();
  });

  it('walks the whole history on a first release', async () => {
    lastTagMock.mockResolvedValue(null);
    commitFileSetsMock.mockResolvedValue([['lib/a.ts'], ['lib/b.ts']]);

    await expect(healPublishedTag(lib, [lib], '0.1.0', 'headsha', opts, log)).rejects.toThrow(
      '2 commits since the first commit touch lib',
    );
    expect(commitFileSetsMock).toHaveBeenCalledWith(null, opts);
  });

  it('does nothing when origin already has the tag', async () => {
    remoteTagExistsMock.mockResolvedValue(true);

    await healPublishedTag(lib, [lib], '1.0.1', 'headsha', opts, log);

    expect(commitFileSetsMock).not.toHaveBeenCalled();
    expect(ensureTagMock).not.toHaveBeenCalled();
  });

  it('pushes a local tag left by an earlier run without re-checking HEAD', async () => {
    tagListMock.mockResolvedValue(['lib-v1.0.1']);

    await healPublishedTag(lib, [lib], '1.0.1', 'headsha', opts, log);

    expect(commitFileSetsMock).not.toHaveBeenCalled();
    expect(ensureTagMock).toHaveBeenCalledOnce();
  });
});
