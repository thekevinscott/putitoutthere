/**
 * `tag-template` / `version` / `greater` (pure) run for real so `lastTag`'s
 * highest-semver selection is genuinely exercised.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lastTag } from './last-tag.js';
import { tagList } from './tag-list.js';

vi.mock('./tag-list.js');

const tagListMock = vi.mocked(tagList);
const OPTS = { cwd: 'repo' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('lastTag', () => {
  it('finds the highest-semver among pkg-v*.*.* tags (numeric, not lexical)', async () => {
    tagListMock.mockResolvedValue(['pkg-v0.1.0', 'pkg-v0.1.9', 'pkg-v0.10.0', 'pkg-v0.2.0']);
    // Returns the winning tag alongside its already-parsed version, so
    // callers never re-parse the version out of the tag string.
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toEqual({
      tag: 'pkg-v0.10.0',
      version: { major: 0, minor: 10, patch: 0 },
    });
    // {version} globs to *.*.* so only semver-shaped candidates are listed.
    expect(tagListMock).toHaveBeenCalledWith('pkg-v*.*.*', OPTS);
  });

  it('returns null when no tags for this package exist', async () => {
    tagListMock.mockResolvedValue([]);
    expect(await lastTag('pkg', '{name}-v{version}')).toBeNull();
    expect(tagListMock).toHaveBeenCalledWith('pkg-v*.*.*', {});
  });

  it('ignores tags from other packages', async () => {
    tagListMock.mockResolvedValue(['other-v9.9.9', 'pkg-v0.1.0']);
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toEqual({
      tag: 'pkg-v0.1.0',
      version: { major: 0, minor: 1, patch: 0 },
    });
  });

  it('skips malformed tags under the package prefix', async () => {
    tagListMock.mockResolvedValue(['pkg-v0.1.0', 'pkg-vnope']);
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toEqual({
      tag: 'pkg-v0.1.0',
      version: { major: 0, minor: 1, patch: 0 },
    });
  });

  it('skips tags matching the glob but rejected by strict semver', async () => {
    // parseTagVersion rejects leading zeros (returns null), so the candidate
    // is skipped before it can win — no in-loop re-parse guard needed.
    tagListMock.mockResolvedValue(['pkg-v0.1.0', 'pkg-v01.02.03']);
    expect(await lastTag('pkg', '{name}-v{version}', OPTS)).toEqual({
      tag: 'pkg-v0.1.0',
      version: { major: 0, minor: 1, patch: 0 },
    });
  });

  it('honors a custom `v{version}` tag_format for single-package repos', async () => {
    tagListMock.mockResolvedValue(['v0.1.0', 'v0.2.11']);
    expect(await lastTag('pkg', 'v{version}', OPTS)).toEqual({
      tag: 'v0.2.11',
      version: { major: 0, minor: 2, patch: 11 },
    });
    // The `v*.*.*` glob won't match a default-shaped `pkg-v...` tag.
    expect(tagListMock).toHaveBeenCalledWith('v*.*.*', OPTS);
  });
});
