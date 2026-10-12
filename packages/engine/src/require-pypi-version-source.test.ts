import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { checkPypiVersionSource } from './preflight.js';
import { requirePypiVersionSource } from './require-pypi-version-source.js';

vi.mock('./preflight.js');

const checkMock = vi.mocked(checkPypiVersionSource);
const packages = [{ name: 'py', kind: 'pypi' }] as unknown as readonly Package[];

async function thrownMessage(): Promise<string> {
  try {
    await requirePypiVersionSource(packages);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requirePypiVersionSource to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requirePypiVersionSource', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requirePypiVersionSource(packages)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages);
  });

  it('throws one error listing every failing package', async () => {
    checkMock.mockResolvedValue([
      { package: 'a', pyprojectPath: 'a/pyproject.toml' },
      { package: 'b', pyprojectPath: 'b/pyproject.toml' },
    ]);
    const lines = (await thrownMessage()).split('\n');
    expect(lines[0]).toBe(
      '[PIOT_PYPI_STATIC_VERSION] pyproject.toml must declare `[project].dynamic = ["version"]` instead of a static `[project].version = "..."` literal.',
    );
    expect(lines.slice(1, 5)).toEqual([
      '',
      'Failing packages:',
      '  - a: a/pyproject.toml',
      '  - b: b/pyproject.toml',
    ]);
  });

  it('ends with the hatch-vcs recipe and the docs pointer', async () => {
    checkMock.mockResolvedValue([{ package: 'a', pyprojectPath: 'a/pyproject.toml' }]);
    const lines = (await thrownMessage()).split('\n');
    expect(lines.slice(4)).toEqual([
      '',
      'Why: putitoutthere does not edit pyproject.toml at release time (per the',
      '"no version computation" design commitment). A static literal silently',
      'ships the previous release\'s wheel/sdist, because the build backend reads',
      'whatever is on disk.',
      '',
      'Recommended fix (hatch-vcs):',
      '',
      '  [build-system]',
      '  requires = ["hatchling", "hatch-vcs"]',
      '  build-backend = "hatchling.build"',
      '',
      '  [project]',
      '  name = "<your-package>"',
      '  dynamic = ["version"]',
      '',
      '  [tool.hatch.version]',
      '  source = "vcs"',
      '',
      'setuptools-scm and the maturin (Cargo.toml-driven) path are equally',
      'valid — see https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions.',
    ]);
  });
});
