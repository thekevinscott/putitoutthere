import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkProvenanceMetadata } from './check-provenance-metadata.js';
import type { Package } from './config.js';

vi.mock('node:fs/promises');

const files = new Map<string, string>();

function npmPkg(name: string, path = name): Package {
  return { name, kind: 'npm', path } as unknown as Package;
}

function writePkgJson(path: string, body: unknown): void {
  files.set(join(path, 'package.json'), JSON.stringify(body));
}

beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockImplementation(((path: string) => {
    const found = files.get(path);
    return found === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(found);
  }) as unknown as typeof readFile);
});

describe('checkProvenanceMetadata (#280)', () => {
  it('passes when an npm package has a non-empty repository.url object', async () => {
    writePkgJson('a', { name: 'a', repository: { type: 'git', url: 'git+https://github.com/x/y.git' } });
    expect(await checkProvenanceMetadata([npmPkg('a')])).toEqual([]);
    expect(readFile).toHaveBeenCalledWith(join('a', 'package.json'), 'utf8');
  });

  it('passes when repository is the legacy non-empty string form', async () => {
    writePkgJson('a', { name: 'a', repository: 'git+https://github.com/x/y.git' });
    expect(await checkProvenanceMetadata([npmPkg('a')])).toEqual([]);
  });

  it('reports every package whose repository is missing, empty, url-less or blank', async () => {
    writePkgJson('a', { name: 'a' });
    writePkgJson('b', { name: 'b', repository: '' });
    writePkgJson('c', { name: 'c', repository: { type: 'git' } });
    writePkgJson('d', { name: 'd', repository: { type: 'git', url: '   ' } });
    const names = ['a', 'b', 'c', 'd'];
    expect(await checkProvenanceMetadata(names.map((n) => npmPkg(n)))).toEqual(
      names.map((n) => ({ package: n, packageJsonPath: join(n, 'package.json'), reason: 'empty' })),
    );
  });

  it('reports a missing package.json as a finding rather than crashing', async () => {
    expect(await checkProvenanceMetadata([npmPkg('a', 'does-not-exist')])).toEqual([
      { package: 'a', packageJsonPath: join('does-not-exist', 'package.json'), reason: 'missing' },
    ]);
  });

  it('skips a malformed package.json', async () => {
    files.set(join('a', 'package.json'), '{ not json');
    expect(await checkProvenanceMetadata([npmPkg('a')])).toEqual([]);
  });

  it('skips non-npm packages entirely', async () => {
    const others = [
      { name: 'c', kind: 'crates', path: 'c' },
      { name: 'p', kind: 'pypi', path: 'p' },
    ] as unknown as Package[];
    expect(await checkProvenanceMetadata(others)).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });
});
