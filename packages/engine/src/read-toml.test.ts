import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readToml } from './read-toml.js';

vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);

beforeEach(() => {
  readFileMock.mockReset();
});

describe('readToml', () => {
  it('reads the file as utf8 and returns the parsed document', async () => {
    readFileMock.mockResolvedValue('[package]\nname = "widget"\n');
    await expect(readToml('/repo/Cargo.toml')).resolves.toEqual({ package: { name: 'widget' } });
    expect(readFileMock).toHaveBeenCalledWith('/repo/Cargo.toml', 'utf8');
  });

  it('returns null when the file cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    await expect(readToml('/repo/Cargo.toml')).resolves.toBeNull();
  });

  it('returns null when the contents are not valid TOML', async () => {
    readFileMock.mockResolvedValue('[[broken');
    await expect(readToml('/repo/Cargo.toml')).resolves.toBeNull();
  });
});
