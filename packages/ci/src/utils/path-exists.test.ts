import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathExists } from './path-exists.js';

describe('pathExists', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'path-exists-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns true for an existing file', async () => {
    const file = join(dir, 'present.txt');
    await writeFile(file, 'x');
    expect(await pathExists(file)).toBe(true);
  });

  it('returns false for a missing path', async () => {
    expect(await pathExists(join(dir, 'missing.txt'))).toBe(false);
  });
});
