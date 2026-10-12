import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { candidateDirs } from './candidate-dirs.js';
import { expandDirGlob } from './glob.js';

vi.mock('./glob.js');

const expandMock = vi.mocked(expandDirGlob);

beforeEach(() => {
  vi.resetAllMocks();
  expandMock.mockImplementation((base, pattern) => Promise.resolve([`${base}/${pattern}`]));
});

describe('candidateDirs', () => {
  it('returns only the resolved siblings when there is no workspace', async () => {
    const dirs = await candidateDirs(null, null, ['/r/a', '/r/b/']);
    expect([...dirs]).toEqual([resolve('/r/a'), resolve('/r/b')]);
    expect(expandMock).not.toHaveBeenCalled();
  });

  it('returns an empty set with no workspace and no siblings', async () => {
    expect((await candidateDirs(null, null, undefined)).size).toBe(0);
  });

  it('adds the workspace root and each expanded string member', async () => {
    const parsed = { workspace: { members: ['core', 42, 'host'] } };
    const dirs = await candidateDirs('/r', parsed, ['/x/sib']);
    expect([...dirs]).toEqual([resolve('/x/sib'), resolve('/r'), resolve('/r/core'), resolve('/r/host')]);
    expect(expandMock.mock.calls).toEqual([
      ['/r', 'core'],
      ['/r', 'host'],
    ]);
  });

  it('adds every directory a glob member expands to, deduplicated', async () => {
    expandMock.mockResolvedValue(['/r/crates/a', '/r/crates/b', '/r/crates/a']);
    const dirs = await candidateDirs('/r', { workspace: { members: ['crates/*'] } }, undefined);
    expect([...dirs]).toEqual([resolve('/r'), resolve('/r/crates/a'), resolve('/r/crates/b')]);
  });

  it.each([null, {}, { workspace: {} }, { workspace: { members: 'core' } }])(
    'keeps only the root when the members list is absent or not an array (%j)',
    async (parsed) => {
      const dirs = await candidateDirs('/r', parsed, undefined);
      expect([...dirs]).toEqual([resolve('/r')]);
    },
  );
});
