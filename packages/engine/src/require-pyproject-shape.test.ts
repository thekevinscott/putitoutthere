import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPyprojectShape } from './check-pyproject-shape.js';
import type { Package } from './config.js';
import { requirePyprojectShape } from './require-pyproject-shape.js';

vi.mock('./check-pyproject-shape.js');

const checkMock = vi.mocked(checkPyprojectShape);
const packages = [{ name: 'a', kind: 'pypi' }] as unknown as readonly Package[];

async function thrownMessage(): Promise<string> {
  try {
    await requirePyprojectShape(packages);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requirePyprojectShape to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requirePyprojectShape', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requirePyprojectShape(packages)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages);
  });

  it('throws naming every failing package + the error code', async () => {
    checkMock.mockResolvedValue([
      {
        package: 'a',
        pyprojectPath: 'py/a/pyproject.toml',
        code: 'PIOT_PYPI_NAME_MISMATCH',
        detail: '[project].name = "wrong" but configured name is "a"',
      },
      {
        package: 'b',
        pyprojectPath: 'py/b/pyproject.toml',
        code: 'PIOT_PYPI_BUILD_BACKEND_MISMATCH',
        detail: 'backend detail',
      },
    ]);
    expect((await thrownMessage()).split('\n')).toEqual([
      'Pre-flight pyproject.toml shape check failed:',
      '',
      '  [PIOT_PYPI_NAME_MISMATCH] a: py/a/pyproject.toml',
      '    [project].name = "wrong" but configured name is "a"',
      '  [PIOT_PYPI_BUILD_BACKEND_MISMATCH] b: py/b/pyproject.toml',
      '    backend detail',
      '',
      'Why: these mismatches would otherwise surface 10-20 minutes into a release run',
      'when the build backend (maturin / setuptools / hatchling) finally tripped on them.',
      'Fix the pyproject.toml + putitoutthere.toml fields in this list, then re-run.',
    ]);
  });
});
