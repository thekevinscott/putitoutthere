import { beforeEach, describe, expect, it, vi } from 'vitest';

// Bare automocks (no factory): vitest derives the doubles from the real
// modules so they can't drift, satisfying unit-suite isolation without a
// hand-written (untyped) factory. Default return values are set per-test in
// beforeEach; the real handlers are covered by their own colocated suites
// and the integration/e2e tiers.
vi.mock('./main.js');
vi.mock('./triple.js');

import { verifyNpmTarball } from './index.js';
import { verifyNpmTarballMain } from './main.js';
import { verifyNpmTarballTriple } from './triple.js';

const mainMock = vi.mocked(verifyNpmTarballMain);
const tripleMock = vi.mocked(verifyNpmTarballTriple);

beforeEach(() => {
  vi.resetAllMocks();
  mainMock.mockResolvedValue(0);
  tripleMock.mockResolvedValue(1);
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
