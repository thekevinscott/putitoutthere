import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { npmBuildMatrix } from './npm-build-matrix.js';
import { npmBuildPackage } from './npm-build-package.js';

vi.mock('./npm-build-package.js');

const buildPackage = vi.mocked(npmBuildPackage);
let out: string[];
const root = resolve('/repo');

beforeEach(() => {
  buildPackage.mockReset().mockResolvedValue(undefined);
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    out.push(String(s));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('npmBuildMatrix', () => {
  it('builds each npm path once as TARGET=main with an empty BUILD and the first row\'s version', async () => {
    await npmBuildMatrix(JSON.stringify([
      { kind: 'npm', path: 'a', version: '1.0.0', target: 'main', build: 'napi' },
      { kind: 'npm', path: 'a', version: '9.9.9', target: 'linux-x64-gnu', build: 'napi' },
      { kind: 'crates', path: 'c', version: '3.0.0' },
      { kind: 'npm', path: 'b', version: '2.0.0' },
    ]), root);
    expect(buildPackage.mock.calls.map((c) => c[0])).toEqual([
      { dir: resolve(root, 'a'), boundary: root, target: 'main', build: '', version: '1.0.0' },
      { dir: resolve(root, 'b'), boundary: root, target: 'main', build: '', version: '2.0.0' },
    ]);
    expect(out).toEqual([
      '::group::npm install + build at a\n',
      '::endgroup::\n',
      '::group::npm install + build at b\n',
      '::endgroup::\n',
    ]);
  });

  it('does nothing without npm rows', async () => {
    await npmBuildMatrix(JSON.stringify([{ kind: 'pypi', path: 'p', version: '1.0.0' }]), root);
    expect(buildPackage).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('closes the group and stops at the first failing package', async () => {
    buildPackage.mockRejectedValueOnce(new Error('Command failed: npm install'));
    await expect(npmBuildMatrix(JSON.stringify([
      { kind: 'npm', path: 'a', version: '1.0.0' },
      { kind: 'npm', path: 'b', version: '2.0.0' },
    ]), root)).rejects.toThrow('npm install');
    expect(buildPackage).toHaveBeenCalledTimes(1);
    expect(out).toEqual(['::group::npm install + build at a\n', '::endgroup::\n']);
  });
});
