/**
 * Pins that `readRaw` returns the file's bytes as UTF-8 and null when the read
 * throws (missing file), mirroring the bash `cat "$f" 2>/dev/null`.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRaw } from './read-raw.js';

vi.mock('node:fs');

const read = vi.mocked(readFileSync);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readRaw', () => {
  it('returns the file contents as UTF-8', () => {
    read.mockReturnValue('hello\n');
    expect(readRaw('/tmp/x.log')).toBe('hello\n');
    expect(read).toHaveBeenCalledWith('/tmp/x.log', 'utf8');
  });

  it('returns null when the read throws (file absent)', () => {
    read.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readRaw('/tmp/missing')).toBeNull();
  });
});
