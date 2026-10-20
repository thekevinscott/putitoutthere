import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readRequiresPython } from './read-requires-python.js';

vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);

describe('readRequiresPython', () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it('returns [project].requires-python, reading the file as utf8', async () => {
    readFileMock.mockResolvedValue('[project]\nrequires-python = ">=3.12"\n');
    expect(await readRequiresPython('/repo/pyproject.toml')).toBe('>=3.12');
    expect(readFileMock).toHaveBeenCalledWith('/repo/pyproject.toml', 'utf8');
  });

  it('returns null when the file is missing', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));
    expect(await readRequiresPython('/repo/pyproject.toml')).toBeNull();
  });

  it('returns null for malformed TOML', async () => {
    readFileMock.mockResolvedValue('this is not = = valid toml [[');
    expect(await readRequiresPython('/repo/pyproject.toml')).toBeNull();
  });

  it('returns null when there is no [project] table', async () => {
    readFileMock.mockResolvedValue('[build-system]\nrequires = []\n');
    expect(await readRequiresPython('/repo/pyproject.toml')).toBeNull();
  });

  it('returns null when requires-python is absent', async () => {
    readFileMock.mockResolvedValue('[project]\nname = "x"\n');
    expect(await readRequiresPython('/repo/pyproject.toml')).toBeNull();
  });

  it('returns null when requires-python is not a string', async () => {
    readFileMock.mockResolvedValue('[project]\nrequires-python = 3\n');
    expect(await readRequiresPython('/repo/pyproject.toml')).toBeNull();
  });
});
