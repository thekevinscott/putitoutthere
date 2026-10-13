import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatrixRow } from './completeness.js';
import { listFiles } from './list-files.js';
import { pathExists } from './utils/path-exists.js';
import { verifyRow } from './verify-row.js';
import { verifyShape } from './verify-shape.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./list-files.js');
vi.mock('./utils/path-exists.js');
vi.mock('./verify-shape.js');

const listFilesMock = vi.mocked(listFiles);
const pathExistsMock = vi.mocked(pathExists);
const verifyShapeMock = vi.mocked(verifyShape);

function row(over: Partial<MatrixRow>): MatrixRow {
  return { name: 'demo', kind: 'pypi', version: '0.1.0', target: 'sdist', artifact_name: 'demo-sdist', ...over };
}

const dir = join('artifacts', 'demo-sdist');

beforeEach(() => {
  vi.resetAllMocks();
  pathExistsMock.mockResolvedValue(true);
  listFilesMock.mockResolvedValue(['artifacts/demo-sdist/demo-0.1.0.tar.gz']);
  verifyShapeMock.mockReturnValue(null);
});

describe('verifyRow', () => {
  it('skips crates rows without touching the filesystem', async () => {
    await expect(verifyRow(row({ kind: 'crates' }), 'artifacts')).resolves.toBeNull();
    expect(pathExistsMock).not.toHaveBeenCalled();
  });

  it('skips vanilla npm (noarch) rows without touching the filesystem', async () => {
    await expect(verifyRow(row({ kind: 'npm', target: 'noarch' }), 'artifacts')).resolves.toBeNull();
    expect(pathExistsMock).not.toHaveBeenCalled();
  });

  it('checks a noarch row of any kind but npm', async () => {
    await verifyRow(row({ target: 'noarch' }), 'artifacts');
    expect(pathExistsMock).toHaveBeenCalledWith(dir);
  });

  it('checks npm rows that are not noarch', async () => {
    await verifyRow(row({ kind: 'npm', target: 'main' }), 'artifacts');
    expect(pathExistsMock).toHaveBeenCalledWith(dir);
  });

  it('reports a missing artifact directory', async () => {
    pathExistsMock.mockResolvedValue(false);
    await expect(verifyRow(row({}), 'artifacts')).resolves.toBe('missing artifact directory demo-sdist/');
    expect(pathExistsMock).toHaveBeenCalledWith(dir);
    expect(listFilesMock).not.toHaveBeenCalled();
  });

  it('reports an unreadable directory with the error message', async () => {
    listFilesMock.mockRejectedValue(new Error('EACCES: permission denied'));
    await expect(verifyRow(row({}), 'artifacts')).resolves.toBe(
      'cannot read demo-sdist/: EACCES: permission denied',
    );
  });

  it('stringifies a non-Error read failure', async () => {
    listFilesMock.mockRejectedValue('raw string failure');
    await expect(verifyRow(row({}), 'artifacts')).resolves.toBe(
      'cannot read demo-sdist/: raw string failure',
    );
  });

  it('reports an empty directory', async () => {
    listFilesMock.mockResolvedValue([]);
    await expect(verifyRow(row({}), 'artifacts')).resolves.toBe('empty artifact directory demo-sdist/');
    expect(verifyShapeMock).not.toHaveBeenCalled();
  });

  it('delegates a non-empty listing to verifyShape and returns its verdict', async () => {
    verifyShapeMock.mockReturnValue('wrong shape');
    const r = row({});
    await expect(verifyRow(r, 'artifacts')).resolves.toBe('wrong shape');
    expect(listFilesMock).toHaveBeenCalledWith(dir);
    expect(verifyShapeMock).toHaveBeenCalledWith(r, ['artifacts/demo-sdist/demo-0.1.0.tar.gz']);
  });
});
