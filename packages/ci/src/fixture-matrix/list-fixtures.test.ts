import { readdir } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFixtures } from './list-fixtures.js';

vi.mock('node:fs/promises');

type Dirents = Awaited<ReturnType<typeof readdir>>;

const readdirMock = vi.mocked(readdir);

function dirent(name: string, isDir: boolean): { name: string; isDirectory: () => boolean } {
  return { name, isDirectory: () => isDir };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listFixtures', () => {
  it('reads the fixtures root with file types and returns only directory names', async () => {
    readdirMock.mockResolvedValue([
      dirent('js-vanilla', true),
      dirent('README.md', false),
      dirent('rust-crate', true),
    ] as unknown as Dirents);
    await expect(listFixtures('/fixtures')).resolves.toEqual(['js-vanilla', 'rust-crate']);
    expect(readdirMock).toHaveBeenCalledWith('/fixtures', { withFileTypes: true });
  });

  it('returns an empty list when the root holds no directories', async () => {
    readdirMock.mockResolvedValue([dirent('README.md', false)] as unknown as Dirents);
    await expect(listFixtures('/fixtures')).resolves.toEqual([]);
  });
});
