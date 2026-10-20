import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandDirGlob } from './expand-dir-glob.js';

vi.mock('node:fs/promises', async () => await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'));
vi.mock('node:os', async () => await vi.importActual<typeof import('node:os')>('node:os'));
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));

describe('expandDirGlob (filesystem expansion)', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'expand-dir-glob-'));
    // packages/{alpha,beta} are directories; packages/note.txt is a file
    // so the isDirectory() guard has a non-directory entry to reject.
    await mkdir(join(base, 'packages', 'alpha'), { recursive: true });
    await mkdir(join(base, 'packages', 'beta'), { recursive: true });
    await writeFile(join(base, 'packages', 'note.txt'), 'x');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('resolves a literal (non-glob) segment without touching the filesystem', async () => {
    // No metacharacter: the segment is joined blindly and returned even
    // though `missing/` does not exist on disk.
    expect(await expandDirGlob(base, 'missing/child')).toEqual([
      join(base, 'missing', 'child'),
    ]);
  });

  it('drops empty segments instead of joining them onto the base', async () => {
    expect(await expandDirGlob('ws/./root', '')).toEqual(['ws/./root']);
  });

  it('expands a glob segment to matching directories only (skips files)', async () => {
    const result = await expandDirGlob(base, 'packages/*');
    expect(result.sort()).toEqual(
      [join(base, 'packages', 'alpha'), join(base, 'packages', 'beta')].sort(),
    );
    // note.txt (a file) is excluded by the isDirectory() guard.
    expect(result).not.toContain(join(base, 'packages', 'note.txt'));
  });

  it('applies the glob pattern to directory names (non-matching dirs drop out)', async () => {
    // `alp*` matches alpha but not beta, exercising the matchesGlob() guard.
    expect(await expandDirGlob(base, 'packages/alp*')).toEqual([
      join(base, 'packages', 'alpha'),
    ]);
  });

  it('yields nothing when a glob segment is matched against a missing directory', async () => {
    // The base dir does not exist, so the pathExists() guard `continue`s
    // and the expansion returns empty rather than throwing.
    expect(await expandDirGlob(join(base, 'does-not-exist'), '*')).toEqual([]);
  });
});
