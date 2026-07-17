/**
 * Glob matcher tests. Covers every row in plan.md §11.4.
 *
 * Issue #10.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchesGlob, matchesAny, expandDirGlob } from './glob.js';

vi.mock('node:fs/promises', async () => await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'));
vi.mock('node:os', async () => await vi.importActual<typeof import('node:os')>('node:os'));
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));

describe('matchesGlob (§11.4 table)', () => {
  it.each([
    ['packages/python/**/*.py', 'packages/python/foo.py', true],
    ['packages/python/**/*.py', 'packages/python/sub/foo.py', true],
    ['packages/python/**/*.py', 'packages/python/foo.rs', false],
    ['packages/python/**/*.py', 'packages/rust/foo.py', false],

    ['packages/python/**', 'packages/python/foo.py', true],
    ['packages/python/**', 'packages/python/sub/deep/file.txt', true],
    ['packages/python/**', 'packages/rust/foo.py', false],

    ['packages/{python,rust}/**', 'packages/python/a.py', true],
    ['packages/{python,rust}/**', 'packages/rust/a.rs', true],
    ['packages/{python,rust}/**', 'packages/docs/index.md', false],

    ['Cargo.lock', 'Cargo.lock', true],
    ['Cargo.lock', 'packages/rust/Cargo.lock', false],
    // Leading `**/` is NOT implicit (matchBase: false). Users must write
    // it explicitly to cascade on nested files. Docs: guide/cascade.md.
    ['**/Cargo.lock', 'Cargo.lock', true],
    ['**/Cargo.lock', 'packages/rust/Cargo.lock', true],
  ])('glob %s against path %s → %s', (pattern, path, expected) => {
    expect(matchesGlob(pattern, path)).toBe(expected);
  });
});

describe('matchesGlob: dotfiles', () => {
  it('matches hidden files (dot: true)', () => {
    // `.github/workflows/foo.yml` vs `**/*.yml` — minimatch's default
    // would skip dot-prefixed dirs; we enable `dot: true` because real
    // repos keep release configs under `.github/`.
    expect(matchesGlob('**/*.yml', '.github/workflows/release.yml')).toBe(true);
  });
});

describe('matchesAny', () => {
  it('returns true when any pattern matches', () => {
    expect(matchesAny(['a/**', 'b/**'], 'b/x.ts')).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    expect(matchesAny(['a/**', 'b/**'], 'c/x.ts')).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesAny([], 'a.ts')).toBe(false);
  });
});

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
