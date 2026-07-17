import { stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { localDirState } from './local-dir-state.js';

// Bare automocks (no factory) isolate the unit under test: `node:fs/promises`
// and the recursive-listing collaborator are driven directly, so no real temp
// dirs are created. `localDirState` interpolates its argument and the listing
// verbatim (no `path.join`), so the asserted strings are identical on every
// OS. Real directory round-tripping is covered by the integration/e2e tiers.
vi.mock('node:fs/promises');
vi.mock('../../utils/list-files-recursive.js');

const statMock = vi.mocked(stat);
const listMock = vi.mocked(listFilesRecursive);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('localDirState', () => {
  it('reports present + file count + listing when the dir exists locally', async () => {
    // `pathExists` resolves, and the dir check sees a directory.
    statMock.mockResolvedValue({ isDirectory: () => true } as never);
    listMock.mockResolvedValue(['dist/index.js']);

    expect(await localDirState('dist')).toBe('local dist: present, 1 file(s) — dist/index.js ');
  });

  it('reports missing when the path does not exist', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await localDirState('gone')).toBe('local gone: missing');
  });

  it('reports missing when the path exists but is a file, not a directory', async () => {
    statMock.mockResolvedValue({ isDirectory: () => false } as never);
    expect(await localDirState('dist')).toBe('local dist: missing');
  });
});
