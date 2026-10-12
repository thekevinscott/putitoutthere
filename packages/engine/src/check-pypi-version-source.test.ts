import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPypiVersionSource } from './check-pypi-version-source.js';
import type { Package } from './config.js';

vi.mock('node:fs/promises');
vi.mock('smol-toml', async () => {
  const actual = await vi.importActual<typeof import('smol-toml')>('smol-toml');
  return { ...actual, parse: vi.fn(actual.parse) };
});

const files = new Map<string, string>();

function pypiPkg(name: string, path = name): Package {
  return { name, kind: 'pypi', path } as unknown as Package;
}

function writePyproject(path: string, body: string): void {
  files.set(join(path, 'pyproject.toml'), body);
}

beforeEach(() => {
  files.clear();
  vi.mocked(parse).mockClear();
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockImplementation(((path: string) => {
    const found = files.get(path);
    return found === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(found);
  }) as unknown as typeof readFile);
});

describe('checkPypiVersionSource (#333)', () => {
  it('flags a static [project].version literal', async () => {
    writePyproject('a', '[project]\nname = "a"\nversion = "1.2.3"\n');
    expect(await checkPypiVersionSource([pypiPkg('a')])).toEqual([
      { package: 'a', pyprojectPath: join('a', 'pyproject.toml') },
    ]);
    expect(readFile).toHaveBeenCalledWith(join('a', 'pyproject.toml'), 'utf8');
  });

  it('passes when [project].dynamic includes "version"', async () => {
    writePyproject('a', '[project]\nname = "a"\nversion = "1.0.0"\ndynamic = ["version"]\n');
    expect(await checkPypiVersionSource([pypiPkg('a')])).toEqual([]);
  });

  it('flags a static version even when dynamic lists other fields', async () => {
    writePyproject('a', '[project]\nname = "a"\nversion = "1.0.0"\ndynamic = ["classifiers"]\n');
    expect(await checkPypiVersionSource([pypiPkg('a')])).toHaveLength(1);
  });

  it('flags a static version when dynamic is not an array', async () => {
    writePyproject('a', '[project]\nname = "a"\nversion = "1.0.0"\ndynamic = "version"\n');
    expect(await checkPypiVersionSource([pypiPkg('a')])).toHaveLength(1);
  });

  it('stays silent when [project] declares no version string', async () => {
    writePyproject('a', '[project]\nname = "a"\n');
    writePyproject('b', '[project]\nname = "b"\nversion = 1\n');
    expect(await checkPypiVersionSource([pypiPkg('a'), pypiPkg('b')])).toEqual([]);
  });

  it('skips a pyproject with no [project] table', async () => {
    writePyproject('a', '[build-system]\nbuild-backend = "setuptools.build_meta"\n');
    expect(await checkPypiVersionSource([pypiPkg('a')])).toEqual([]);
  });

  it('skips a missing or malformed pyproject.toml and keeps scanning', async () => {
    writePyproject('malformed', '[[broken\nnot toml');
    writePyproject('b', '[project]\nname = "b"\nversion = "2.0.0"\n');
    const findings = await checkPypiVersionSource([
      pypiPkg('missing'),
      pypiPkg('malformed'),
      pypiPkg('b'),
    ]);
    expect(findings.map((f) => f.package)).toEqual(['b']);
  });

  it('does not parse anything when pyproject.toml cannot be read', async () => {
    expect(await checkPypiVersionSource([pypiPkg('missing')])).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it('skips non-pypi packages entirely', async () => {
    const others = [
      { name: 'c', kind: 'crates', path: 'c' },
      { name: 'n', kind: 'npm', path: 'n' },
    ] as unknown as Package[];
    expect(await checkPypiVersionSource(others)).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reports every failing pypi package, not just the first', async () => {
    writePyproject('a', '[project]\nname = "a"\nversion = "1.0.0"\n');
    writePyproject('b', '[project]\nname = "b"\nversion = "2.0.0"\n');
    const findings = await checkPypiVersionSource([pypiPkg('a'), pypiPkg('b')]);
    expect(findings.map((f) => f.package)).toEqual(['a', 'b']);
  });
});
