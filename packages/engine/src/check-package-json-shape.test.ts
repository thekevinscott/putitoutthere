import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPackageJsonShape } from './check-package-json-shape.js';
import type { Package } from './config.js';

vi.mock('node:fs/promises');

const files = new Map<string, string>();

function npmPkg(name: string, path: string, npm?: string): Package {
  return { name, kind: 'npm', path, ...(npm === undefined ? {} : { npm }) } as unknown as Package;
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

describe('checkPackageJsonShape', () => {
  it('passes when package.json name matches the configured name', async () => {
    writePkgJson('a', { name: 'a' });
    expect(await checkPackageJsonShape([npmPkg('a', 'a')])).toEqual([]);
    expect(readFile).toHaveBeenCalledWith(join('a', 'package.json'), 'utf8');
  });

  it('flags PIOT_NPM_NAME_MISMATCH when package.json name differs from the configured name', async () => {
    writePkgJson('foo', { name: 'foo' });
    expect(await checkPackageJsonShape([npmPkg('js/foo', 'foo')])).toEqual([
      {
        package: 'js/foo',
        packageJsonPath: join('foo', 'package.json'),
        code: 'PIOT_NPM_NAME_MISMATCH',
        detail: 'name = "foo" but configured name is "js/foo"',
      },
    ]);
  });

  it('compares against the `npm` override when set', async () => {
    writePkgJson('a', { name: '@scope/foo' });
    writePkgJson('b', { name: '@scope/foo' });
    const findings = await checkPackageJsonShape([
      npmPkg('js/foo', 'a', '@scope/foo'),
      npmPkg('foo', 'b', '@scope/bar'),
    ]);
    expect(findings.map((f) => [f.package, f.detail])).toEqual([
      ['foo', 'name = "@scope/foo" but configured name is "@scope/bar"'],
    ]);
  });

  it('skips missing, malformed and nameless package.json files and keeps scanning', async () => {
    files.set(join('bad', 'package.json'), '{ not json');
    writePkgJson('noname', { version: '0.0.0' });
    writePkgJson('wrong', { name: 'other' });
    const findings = await checkPackageJsonShape([
      npmPkg('missing', 'missing'),
      npmPkg('bad', 'bad'),
      npmPkg('noname', 'noname'),
      npmPkg('wrong', 'wrong'),
    ]);
    expect(findings.map((f) => f.package)).toEqual(['wrong']);
  });

  it('skips non-npm packages entirely', async () => {
    const others = [
      { name: 'c', kind: 'crates', path: 'c' },
      { name: 'p', kind: 'pypi', path: 'p' },
    ] as unknown as Package[];
    expect(await checkPackageJsonShape(others)).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });
});
