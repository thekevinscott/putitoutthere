import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./verify-npm-tarball-main.js', () => ({ verifyNpmTarballMain: vi.fn().mockResolvedValue(0) }));
vi.mock('./verify-npm-tarball-triple.js', () => ({ verifyNpmTarballTriple: vi.fn().mockResolvedValue(1) }));

import { verifyNpmTarball } from './verify-npm-tarball.js';
import { verifyNpmTarballMain } from './verify-npm-tarball-main.js';
import { verifyNpmTarballTriple } from './verify-npm-tarball-triple.js';

const mainMock = vi.mocked(verifyNpmTarballMain);
const tripleMock = vi.mocked(verifyNpmTarballTriple);

beforeEach(() => {
  mainMock.mockClear();
  tripleMock.mockClear();
});

describe('verifyNpmTarball (dispatch)', () => {
  const matrix = JSON.stringify([{ name: 'a', kind: 'npm', version: '1.0.0', target: 'main', path: 'p' }]);

  it('parses the matrix and routes to the main check by default', async () => {
    const code = await verifyNpmTarball({ cwd: '/x', matrix });
    expect(code).toBe(0);
    expect(mainMock).toHaveBeenCalledOnce();
    expect(mainMock.mock.calls[0]![0]).toEqual([
      { name: 'a', kind: 'npm', version: '1.0.0', target: 'main', path: 'p' },
    ]);
    expect(tripleMock).not.toHaveBeenCalled();
  });

  it('routes to the per-triple check when --per-triple is set', async () => {
    const code = await verifyNpmTarball({ cwd: '/x', matrix, perTriple: true });
    expect(code).toBe(1);
    expect(tripleMock).toHaveBeenCalledOnce();
    expect(mainMock).not.toHaveBeenCalled();
  });
});
