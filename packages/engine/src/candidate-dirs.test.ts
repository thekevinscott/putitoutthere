import { beforeEach, describe, expect, it, vi } from 'vitest';

import { candidateDirs } from './candidate-dirs.js';
import { expandDirGlob } from './expand-dir-glob.js';

vi.mock('./expand-dir-glob.js');

const portable = (dirs: Set<string>): string[] =>
  [...dirs].map((d) => d.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''));

const expandMock = vi.mocked(expandDirGlob);

beforeEach(() => {
  vi.resetAllMocks();
  expandMock.mockImplementation((base, pattern) => Promise.resolve([`${base}/${pattern}`]));
});

describe('candidateDirs', () => {
  it('returns only the resolved siblings when there is no workspace', async () => {
    const dirs = await candidateDirs(null, null, ['/r/a', '/r/b/']);
    expect(portable(dirs)).toEqual(['/r/a', '/r/b']);
    expect(expandMock).not.toHaveBeenCalled();
  });

  it('returns an empty set with no workspace and no siblings', async () => {
    expect((await candidateDirs(null, null, undefined)).size).toBe(0);
  });

  it('adds the workspace root and each expanded string member', async () => {
    const parsed = { workspace: { members: ['core', 42, 'host'] } };
    const dirs = await candidateDirs('/r', parsed, ['/x/sib']);
    expect(portable(dirs)).toEqual(['/x/sib', '/r', '/r/core', '/r/host']);
    expect(expandMock.mock.calls).toEqual([
      ['/r', 'core'],
      ['/r', 'host'],
    ]);
  });

  it('adds every directory a glob member expands to, deduplicated', async () => {
    expandMock.mockResolvedValue(['/r/crates/a', '/r/crates/b', '/r/crates/a']);
    const dirs = await candidateDirs('/r', { workspace: { members: ['crates/*'] } }, undefined);
    expect(portable(dirs)).toEqual(['/r', '/r/crates/a', '/r/crates/b']);
  });

  it.each([null, {}, { workspace: {} }, { workspace: { members: 'core' } }])(
    'keeps only the root when the members list is absent or not an array (%j)',
    async (parsed) => {
      const dirs = await candidateDirs('/r', parsed, undefined);
      expect(portable(dirs)).toEqual(['/r']);
    },
  );
});
