import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Config, parseConfig } from './config.js';

vi.mock('node:fs/promises');
vi.mock('./config.js');

import { loadConfig } from './load-config.js';

const readFileMock = vi.mocked(readFile);
const parseConfigMock = vi.mocked(parseConfig);

afterEach(() => {
  readFileMock.mockReset();
  parseConfigMock.mockReset();
});

describe('loadConfig', () => {
  it('parses the utf8 text read from the given path', async () => {
    const config = { packages: [] } as unknown as Config;
    readFileMock.mockResolvedValue('toml text');
    parseConfigMock.mockReturnValue(config);
    expect(await loadConfig('putitoutthere.toml')).toBe(config);
    expect(readFileMock).toHaveBeenCalledWith('putitoutthere.toml', 'utf8');
    expect(parseConfigMock).toHaveBeenCalledWith('toml text');
  });

  it('names the path and keeps the cause when the file cannot be read', async () => {
    const cause = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    readFileMock.mockRejectedValue(cause);
    const err = await loadConfig('does-not-exist.toml').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'putitoutthere.toml: cannot read does-not-exist.toml: ENOENT: no such file',
    );
    expect((err as Error).cause).toBe(cause);
    expect(parseConfigMock).not.toHaveBeenCalled();
  });

  it('wraps a non-Error read failure in the same message', async () => {
    readFileMock.mockRejectedValue('disk gremlins');
    await expect(loadConfig('putitoutthere.toml')).rejects.toThrow(
      'putitoutthere.toml: cannot read putitoutthere.toml: disk gremlins',
    );
  });
});
