/**
 * `findDistFile` — first `<ext>` file directly under a dir (#450).
 *
 * Unit-isolated: `node:fs` is mocked and the readdir/stat results are driven
 * directly, so no real temp dirs are created. Real directory round-tripping
 * is covered by the integration and e2e tiers.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findDistFile } from './find-dist-file.js';

vi.mock('node:fs');

const existsMock = vi.mocked(existsSync);
const readdirMock = vi.mocked(readdirSync);
const statMock = vi.mocked(statSync);

beforeEach(() => {
  vi.resetAllMocks();
  existsMock.mockReturnValue(true);
  statMock.mockReturnValue({ isFile: () => true } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('findDistFile', () => {
  it('finds a .whl', () => {
    readdirMock.mockReturnValue(['demo-1.0.0-py3-none-any.whl'] as never);
    expect(findDistFile('dist', '.whl')?.endsWith('demo-1.0.0-py3-none-any.whl')).toBe(true);
  });

  it('finds a .tar.gz', () => {
    readdirMock.mockReturnValue(['demo-1.0.0.tar.gz'] as never);
    expect(findDistFile('dist', '.tar.gz')?.endsWith('demo-1.0.0.tar.gz')).toBe(true);
  });

  it('returns null when no file matches the extension', () => {
    readdirMock.mockReturnValue(['demo-1.0.0.tar.gz'] as never);
    expect(findDistFile('dist', '.whl')).toBeNull();
  });

  it('returns null for a missing directory', () => {
    existsMock.mockReturnValue(false);
    expect(findDistFile('nope', '.whl')).toBeNull();
  });

  it('ignores a matching directory (files only)', () => {
    readdirMock.mockReturnValue(['weird.whl'] as never);
    statMock.mockReturnValue({ isFile: () => false } as never);
    expect(findDistFile('dist', '.whl')).toBeNull();
  });
});
