/**
 * `findDistFile` — first `<ext>` file directly under a dir (#450).
 *
 * Unit-isolated: `node:fs/promises` is mocked and the readdir/stat results are
 * driven directly, so no real temp dirs are created. Real directory
 * round-tripping is covered by the integration and e2e tiers.
 */

import { readdir, stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findDistFile } from './find-dist-file.js';

vi.mock('node:fs/promises');

const readdirMock = vi.mocked(readdir);
const statMock = vi.mocked(stat);

// `pathExists` returns false when `stat` rejects; ENOENT drives the
// missing-directory branch.
const ENOENT = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

beforeEach(() => {
  vi.resetAllMocks();
  // `stat` serves both `pathExists` (resolves ⇒ present) and the `isFile`
  // check; the default is a present, regular file.
  statMock.mockResolvedValue({ isFile: () => true } as never);
});

describe('findDistFile', () => {
  it('finds a .whl', async () => {
    readdirMock.mockResolvedValue(['demo-1.0.0-py3-none-any.whl'] as never);
    expect((await findDistFile('dist', '.whl'))?.endsWith('demo-1.0.0-py3-none-any.whl')).toBe(true);
  });

  it('finds a .tar.gz', async () => {
    readdirMock.mockResolvedValue(['demo-1.0.0.tar.gz'] as never);
    expect((await findDistFile('dist', '.tar.gz'))?.endsWith('demo-1.0.0.tar.gz')).toBe(true);
  });

  it('returns null when no file matches the extension', async () => {
    readdirMock.mockResolvedValue(['demo-1.0.0.tar.gz'] as never);
    expect(await findDistFile('dist', '.whl')).toBeNull();
  });

  it('returns the alphabetically-first match when several files share the extension', async () => {
    // readdir yields b before a; the `.sort()` makes the result deterministic
    // (a wins) regardless of directory order.
    readdirMock.mockResolvedValue(['demo-b.whl', 'demo-a.whl'] as never);
    expect((await findDistFile('dist', '.whl'))?.endsWith('demo-a.whl')).toBe(true);
  });

  it('returns null for a missing directory', async () => {
    statMock.mockRejectedValue(ENOENT);
    expect(await findDistFile('nope', '.whl')).toBeNull();
  });

  it('ignores a matching directory (files only)', async () => {
    readdirMock.mockResolvedValue(['weird.whl'] as never);
    statMock.mockResolvedValue({ isFile: () => false } as never);
    expect(await findDistFile('dist', '.whl')).toBeNull();
  });
});
