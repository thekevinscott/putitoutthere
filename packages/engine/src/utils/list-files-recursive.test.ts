import { existsSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFilesRecursive } from './list-files-recursive.js';

// Bare automock (no factory): the fs collaborators are the unit-under-test's
// only side channel, so isolate them and drive the directory tree through
// `existsSync` / `readdirSync` returns. Real dir walking over a temp tree is
// covered by the integration tier.
vi.mock('node:fs');

const existsMock = vi.mocked(existsSync);
const readdirMock = vi.mocked(readdirSync);

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
  existsMock.mockReset();
  readdirMock.mockReset();
});

describe('listFilesRecursive', () => {
  it('returns every regular file, descending into subdirectories', () => {
    existsMock.mockReturnValue(true);
    readdirMock.mockImplementation(((p: Parameters<typeof readdirSync>[0]): Dirent[] => {
      switch (norm(p)) {
        case '/root':
          return [dirent('a', true), dirent('top.txt', false)];
        case '/root/a':
          return [dirent('b', true), dirent('mid.txt', false)];
        case '/root/a/b':
          return [dirent('leaf.txt', false)];
        default:
          return [];
      }
    }) as unknown as typeof readdirSync);

    const files = listFilesRecursive('/root').map(norm).sort();
    expect(files).toEqual(['/root/a/b/leaf.txt', '/root/a/mid.txt', '/root/top.txt']);
  });

  it('returns [] for a path that does not exist', () => {
    existsMock.mockReturnValue(false);
    expect(listFilesRecursive('/root/nope')).toEqual([]);
  });

  it('skips entries that are neither a regular file nor a directory (e.g. a socket)', () => {
    existsMock.mockReturnValue(true);
    // A dirent that is neither a directory nor a file (socket/fifo/symlink)
    // exercises the else-of-else-if fall-through: it is silently dropped.
    const special = {
      name: 'sock',
      isDirectory: () => false,
      isFile: () => false,
    } as unknown as Dirent;
    readdirMock.mockImplementation(((p: Parameters<typeof readdirSync>[0]): Dirent[] =>
      norm(p) === '/root' ? [special, dirent('real.txt', false)] : []) as unknown as typeof readdirSync);

    expect(listFilesRecursive('/root').map(norm)).toEqual(['/root/real.txt']);
  });
});
