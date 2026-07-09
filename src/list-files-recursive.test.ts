import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listFilesRecursive } from './list-files-recursive.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lfr-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listFilesRecursive', () => {
  it('returns every regular file, descending into subdirectories', () => {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'top.txt'), '');
    writeFileSync(join(dir, 'a', 'mid.txt'), '');
    writeFileSync(join(dir, 'a', 'b', 'leaf.txt'), '');

    const files = listFilesRecursive(dir).sort();
    expect(files).toEqual(
      [join(dir, 'a', 'b', 'leaf.txt'), join(dir, 'a', 'mid.txt'), join(dir, 'top.txt')].sort(),
    );
  });

  it('returns [] for a path that does not exist', () => {
    expect(listFilesRecursive(join(dir, 'nope'))).toEqual([]);
  });
});
