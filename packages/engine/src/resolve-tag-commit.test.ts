/**
 * `resolveTagCommit` (#410, #403 slice 3): a backfilled tag should point
 * at a sibling package's existing tag for the same version (the real
 * release commit), falling back to HEAD only when no sibling is tagged.
 * The `git` boundary is automocked; the tag-template math is exercised for
 * real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { headCommit, tagCommit, tagList } from './git.js';
import { resolveTagCommit } from './resolve-tag-commit.js';

vi.mock('./git.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function pkg(name: string): Package {
  return {
    name,
    kind: 'crates',
    path: name,
    globs: [],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

describe('resolveTagCommit', () => {
  it('uses a sibling tag when one exists for the version', async () => {
    vi.mocked(tagList).mockResolvedValue(['core-v1.2.3']);
    vi.mocked(tagCommit).mockResolvedValue('sib-sha');
    vi.mocked(headCommit).mockResolvedValue('head-sha');

    const result = await resolveTagCommit('1.2.3', [pkg('core')], { cwd: '/repo' });

    expect(result).toEqual({ commit: 'sib-sha', source: 'sibling' });
    // The sibling's own tag template drove the lookup + commit read.
    expect(vi.mocked(tagList)).toHaveBeenCalledWith('core-v1.2.3', { cwd: '/repo' });
    expect(vi.mocked(tagCommit)).toHaveBeenCalledWith('core-v1.2.3', { cwd: '/repo' });
    expect(vi.mocked(headCommit)).not.toHaveBeenCalled();
  });

  it('falls back to HEAD when no sibling is tagged for the version', async () => {
    vi.mocked(tagList).mockResolvedValue([]);
    vi.mocked(headCommit).mockResolvedValue('head-sha');

    const result = await resolveTagCommit('1.2.3', [pkg('core')], { cwd: '/repo' });

    expect(result).toEqual({ commit: 'head-sha', source: 'head' });
    expect(vi.mocked(headCommit)).toHaveBeenCalledWith({ cwd: '/repo' });
  });

  it('falls back to HEAD when there are no siblings at all', async () => {
    vi.mocked(headCommit).mockResolvedValue('head-sha');

    expect(await resolveTagCommit('1.2.3', [], { cwd: '/repo' })).toEqual({
      commit: 'head-sha',
      source: 'head',
    });
    expect(vi.mocked(tagList)).not.toHaveBeenCalled();
  });

  it('picks the first sibling that has a tag, skipping untagged earlier ones', async () => {
    vi.mocked(tagList).mockImplementation((glob: string) =>
      Promise.resolve(glob === 'b-v1.2.3' ? ['b-v1.2.3'] : []),
    );
    vi.mocked(tagCommit).mockResolvedValue('b-sha');

    const result = await resolveTagCommit('1.2.3', [pkg('a'), pkg('b')], { cwd: '/repo' });

    expect(result).toEqual({ commit: 'b-sha', source: 'sibling' });
    expect(vi.mocked(tagCommit)).toHaveBeenCalledWith('b-v1.2.3', { cwd: '/repo' });
  });
});
