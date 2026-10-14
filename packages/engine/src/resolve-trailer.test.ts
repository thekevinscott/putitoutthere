import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitBody, commitParents } from './git.js';
import { resolveTrailer } from './resolve-trailer.js';

vi.mock('./git.js');

function bodies(map: Record<string, string>): void {
  vi.mocked(commitBody).mockImplementation((sha: string) => Promise.resolve(map[sha] ?? ''));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commitParents).mockResolvedValue(['p0']);
});

describe('resolveTrailer', () => {
  it('returns the HEAD trailer without reading parents', async () => {
    bodies({ head: 'feat\n\nrelease: minor' });
    expect(await resolveTrailer('head', 'repo')).toEqual({ bump: 'minor', packages: [] });
    expect(commitBody).toHaveBeenCalledWith('head', { cwd: 'repo' });
    expect(commitParents).not.toHaveBeenCalled();
  });

  it('returns null for a trailer-less non-merge commit', async () => {
    bodies({ head: 'feat', p0: 'release: major' });
    expect(await resolveTrailer('head', 'repo')).toBeNull();
    expect(commitParents).toHaveBeenCalledWith('head', { cwd: 'repo' });
  });

  it('ignores the first parent of a merge commit', async () => {
    vi.mocked(commitParents).mockResolvedValue(['p0', 'p1']);
    bodies({ head: 'Merge', p0: 'release: major' });
    expect(await resolveTrailer('head', 'repo')).toBeNull();
  });

  it('reads the trailer from a later merge parent', async () => {
    vi.mocked(commitParents).mockResolvedValue(['p0', 'p1', 'p2']);
    bodies({ head: 'Merge', p1: 'fix', p2: 'release: major' });
    expect(await resolveTrailer('head', 'repo')).toEqual({ bump: 'major', packages: [] });
    expect(commitBody).toHaveBeenCalledWith('p2', { cwd: 'repo' });
  });

  it('stops at the first merge parent with a trailer', async () => {
    vi.mocked(commitParents).mockResolvedValue(['p0', 'p1', 'p2']);
    bodies({ head: 'Merge', p1: 'release: minor', p2: 'release: major' });
    expect(await resolveTrailer('head', 'repo')).toEqual({ bump: 'minor', packages: [] });
  });
});
