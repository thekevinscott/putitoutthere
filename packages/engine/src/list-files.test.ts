import { readdir, stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFiles } from './list-files.js';

vi.mock('node:fs/promises');

const readdirMock = vi.mocked(readdir);
const statMock = vi.mocked(stat);

type Entry = { dir: true } | { size: number } | 'other';

const posix = (p: unknown): string => String(p).replace(/\\/g, '/');

function stageTree(tree: Record<string, Entry>, children: Record<string, string[]>): void {
  readdirMock.mockImplementation((p) =>
    Promise.resolve((children[posix(p)] ?? []) as unknown as Awaited<ReturnType<typeof readdir>>),
  );
  statMock.mockImplementation((p) => {
    const e = tree[posix(p)];
    return Promise.resolve({
      isDirectory: () => typeof e === 'object' && 'dir' in e,
      isFile: () => typeof e === 'object' && 'size' in e,
      size: typeof e === 'object' && 'size' in e ? e.size : 7,
    } as unknown as Awaited<ReturnType<typeof stat>>);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listFiles', () => {
  it('returns non-empty files as POSIX paths, descending into subdirectories', async () => {
    stageTree(
      { 'root/a.whl': { size: 3 }, 'root/sub': { dir: true }, 'root/sub/b.tar.gz': { size: 9 } },
      { root: ['a.whl', 'sub'], 'root/sub': ['b.tar.gz'] },
    );
    await expect(listFiles('root')).resolves.toEqual(['root/a.whl', 'root/sub/b.tar.gz']);
    expect(readdirMock.mock.calls.map(([p]) => posix(p))).toEqual(['root', 'root/sub']);
  });

  it('drops zero-byte files and entries that are neither file nor directory', async () => {
    stageTree(
      { 'root/empty.json': { size: 0 }, 'root/sock': 'other', 'root/one.json': { size: 1 } },
      { root: ['empty.json', 'sock', 'one.json'] },
    );
    await expect(listFiles('root')).resolves.toEqual(['root/one.json']);
  });

  it('returns an empty list for an empty directory', async () => {
    stageTree({}, {});
    await expect(listFiles('root')).resolves.toEqual([]);
    expect(statMock).not.toHaveBeenCalled();
  });

  it('propagates a read failure', async () => {
    readdirMock.mockRejectedValue(new Error('EACCES'));
    await expect(listFiles('root')).rejects.toThrow('EACCES');
  });
});
