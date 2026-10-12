import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readCargoManifest } from './read-cargo-manifest.js';

vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('readCargoManifest', () => {
  it('reads <dir>/Cargo.toml as utf8 and returns its source and parsed table', async () => {
    const source = '[package]\nname = "core"\n';
    readFileMock.mockResolvedValue(source);
    await expect(readCargoManifest('/r/core')).resolves.toEqual({
      source,
      parsed: { package: { name: 'core' } },
    });
    expect(readFileMock).toHaveBeenCalledWith(join('/r/core', 'Cargo.toml'), 'utf8');
  });

  it('returns null when the manifest is absent', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(readCargoManifest('/r/none')).resolves.toBeNull();
  });

  it('returns null when the manifest does not parse', async () => {
    readFileMock.mockResolvedValue('[package\nname =');
    await expect(readCargoManifest('/r/bad')).resolves.toBeNull();
  });

  it('surfaces a read failure that is not ENOENT', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    readFileMock.mockRejectedValue(err);
    await expect(readCargoManifest('/r/locked')).rejects.toBe(err);
  });
});
