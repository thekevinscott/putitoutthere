import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePythonVersions } from './python-versions.js';
import { readRequiresPython } from './read-requires-python.js';

vi.mock('./read-requires-python.js');

const readRequiresPythonMock = vi.mocked(readRequiresPython);

describe('resolvePythonVersions', () => {
  beforeEach(() => {
    readRequiresPythonMock.mockReset();
  });

  it('prefers an explicit python_versions override, sorted ascending', async () => {
    readRequiresPythonMock.mockResolvedValue('>=3.10');
    expect(
      await resolvePythonVersions({ path: '.', python_versions: ['3.13', '3.9'] }, '/repo'),
    ).toEqual(['3.9', '3.13']);
    expect(readRequiresPythonMock).not.toHaveBeenCalled();
  });

  it('infers from the package pyproject.toml requires-python when no override is given', async () => {
    readRequiresPythonMock.mockResolvedValue('>=3.12');
    expect(await resolvePythonVersions({ path: 'py' }, '/repo')).toEqual(['3.12', '3.13', '3.14']);
    expect(readRequiresPythonMock).toHaveBeenCalledWith(join('/repo', 'py', 'pyproject.toml'));
  });

  it('falls back to 3.12 when requires-python is unavailable', async () => {
    readRequiresPythonMock.mockResolvedValue(null);
    expect(await resolvePythonVersions({ path: '.' }, '/repo')).toEqual(['3.12']);
  });

  it('falls back to 3.12 when requires-python is unparseable', async () => {
    readRequiresPythonMock.mockResolvedValue('banana');
    expect(await resolvePythonVersions({ path: '.' }, '/repo')).toEqual(['3.12']);
  });
});
