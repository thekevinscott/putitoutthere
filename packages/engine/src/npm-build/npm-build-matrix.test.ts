import { resolve } from 'node:path';

import { expect, it, vi } from 'vitest';

import { npmBuildMatrix } from './npm-build-matrix.js';
import { npmBuildPackage } from './npm-build-package.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./npm-build-package.js');

it('builds each npm path once, as TARGET=main with the first row\'s version', async () => {
  const root = resolve('/repo');
  await npmBuildMatrix(JSON.stringify([
    { kind: 'npm', path: 'a', version: '1.0.0' },
    { kind: 'npm', path: 'a', version: '9.9.9' },
    { kind: 'crates', path: 'c', version: '3.0.0' },
    { kind: 'npm', path: 'b', version: '2.0.0' },
  ]), root);
  expect(vi.mocked(npmBuildPackage).mock.calls).toEqual([
    [resolve(root, 'a'), root, { TARGET: 'main', BUILD: '', VERSION: '1.0.0' }],
    [resolve(root, 'b'), root, { TARGET: 'main', BUILD: '', VERSION: '2.0.0' }],
  ]);
});
