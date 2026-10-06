import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readJson } from './read-json.js';

vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);

beforeEach(() => {
  readFileMock.mockReset();
});

describe('readJson', () => {
  it('reads the file as utf8 and returns the parsed value', async () => {
    readFileMock.mockResolvedValue('{"name":"widget","n":[1,2]}');
    await expect(readJson('/repo/package.json')).resolves.toEqual({ name: 'widget', n: [1, 2] });
    expect(readFileMock).toHaveBeenCalledWith('/repo/package.json', 'utf8');
  });

  it('returns null when the file cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    await expect(readJson('/repo/package.json')).resolves.toBeNull();
  });

  it('returns null when the contents are not valid JSON', async () => {
    readFileMock.mockResolvedValue('{ not json');
    await expect(readJson('/repo/package.json')).resolves.toBeNull();
  });
});
