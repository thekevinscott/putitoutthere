import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesRecursive } from './list-files-recursive.js';

// Bare automock (no factory): the fs collaborators are the unit-under-test's
// only side channel, so isolate them and drive the directory tree through
// `stat` (via `pathExists`) / `readdir` returns. Real dir walking over a temp
// tree is covered by the integration tier.
vi.mock('node:fs/promises');

const statMock = vi.mocked(stat);
const readdirMock = vi.mocked(readdir);

/** A minimal `Dirent` double — only `name` + `isDirectory`/`isFile` matter. */
function dirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as Dirent;
}

// Separator-agnostic: the source joins with node:path (real, unmocked), so on
// Windows the recursion keys arrive back-slashed. Normalize before comparing.
const norm = (p: unknown): string => String(p).replace(/\\/g, '/');

beforeEach(() => {
  statMock.mockReset();
  readdirMock.mockReset();
});

describe('listFilesRecursive', () => {
  it('returns every regular file, descending into subdirectories', async () => {
    // `pathExists` resolves for every path (the tree exists).
    statMock.mockResolvedValue({} as never);
    readdirMock.mockImplementation(((p: Parameters<typeof readdir>[0]): Promise<Dirent[]> => {
      switch (norm(p)) {
        case '/root':
          return Promise.resolve([dirent('a', true), dirent('top.txt', false)]);
        case '/root/a':
          return Promise.resolve([dirent('b', true), dirent('mid.txt', false)]);
        case '/root/a/b':
          return Promise.resolve([dirent('leaf.txt', false)]);
        default:
          return Promise.resolve([]);
      }
    }) as unknown as typeof readdir);

    const files = (await listFilesRecursive('/root')).map(norm).sort();
    expect(files).toEqual(['/root/a/b/leaf.txt', '/root/a/mid.txt', '/root/top.txt']);
  });

  it('returns [] for a path that does not exist', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await listFilesRecursive('/root/nope')).toEqual([]);
  });
});
