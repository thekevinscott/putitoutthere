/**
 * Pins that `readRaw` returns the file's bytes as UTF-8 and null when the read
 * throws (missing file), mirroring the bash `cat "$f" 2>/dev/null`.
 */

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRaw } from './read-raw.js';

vi.mock('node:fs/promises');

const read = vi.mocked(readFile);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readRaw', () => {
  it('returns the file contents as UTF-8', async () => {
    read.mockResolvedValue('hello\n');
    expect(await readRaw('/tmp/x.log')).toBe('hello\n');
    expect(read).toHaveBeenCalledWith('/tmp/x.log', 'utf8');
  });

  it('returns null when the read throws (file absent)', async () => {
    read.mockRejectedValue(new Error('ENOENT'));
    expect(await readRaw('/tmp/missing')).toBeNull();
  });
});
