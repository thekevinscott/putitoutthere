import { existsSync, statSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { localDirState } from './local-dir-state.js';

// Bare automocks (no factory) isolate the unit under test: `node:fs` and the
// recursive-listing collaborator are driven directly, so no real temp dirs
// are created. `localDirState` interpolates its argument and the listing
// verbatim (no `path.join`), so the asserted strings are identical on every
// OS. Real directory round-tripping is covered by the integration/e2e tiers.
vi.mock('node:fs');
vi.mock('../../utils/list-files-recursive.js');

const existsMock = vi.mocked(existsSync);
const statMock = vi.mocked(statSync);
const listMock = vi.mocked(listFilesRecursive);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('localDirState', () => {
  it('reports present + file count + listing when the dir exists locally', () => {
    existsMock.mockReturnValue(true);
    statMock.mockReturnValue({ isDirectory: () => true } as never);
    listMock.mockReturnValue(['dist/index.js']);

    expect(localDirState('dist')).toBe('local dist: present, 1 file(s) — dist/index.js ');
  });

  it('reports missing when the path does not exist', () => {
    existsMock.mockReturnValue(false);
    expect(localDirState('gone')).toBe('local gone: missing');
  });

  it('reports missing when the path exists but is a file, not a directory', () => {
    existsMock.mockReturnValue(true);
    statMock.mockReturnValue({ isDirectory: () => false } as never);
    expect(localDirState('dist')).toBe('local dist: missing');
  });
});
