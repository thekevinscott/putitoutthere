import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { writeDependentVersionReqs } from '../write-dependent-version-reqs.js';
import { writeResolvedCargoVersion } from '../write-resolved-cargo-version.js';
import { cratesWriteVersion } from './crates-write-version.js';

vi.mock('node:fs/promises');
vi.mock('../write-dependent-version-reqs.js');
vi.mock('../write-resolved-cargo-version.js');

const readMock = vi.mocked(readFile);
const resolvedMock = vi.mocked(writeResolvedCargoVersion);
const depsMock = vi.mocked(writeDependentVersionReqs);
const ctx = { siblingPackagePaths: ['/repo/other'] } as unknown as Ctx;
const cargoPath = join('/repo/crate', 'Cargo.toml');

beforeEach(() => {
  readMock.mockReset().mockResolvedValue('[package]\nversion = "0.1.0"\n');
  resolvedMock.mockReset().mockResolvedValue(['/repo/Cargo.toml']);
  depsMock.mockReset().mockResolvedValue(['/repo/other/Cargo.toml']);
});

describe('cratesWriteVersion', () => {
  it('returns the resolved manifest followed by rewritten dependents', async () => {
    await expect(cratesWriteVersion({ path: '/repo/crate' }, '0.2.0', ctx)).resolves.toEqual([
      '/repo/Cargo.toml',
      '/repo/other/Cargo.toml',
    ]);
    expect(readMock).toHaveBeenCalledWith(cargoPath, 'utf8');
    expect(resolvedMock).toHaveBeenCalledWith('/repo/crate', '[package]\nversion = "0.1.0"\n', '0.2.0');
    expect(depsMock).toHaveBeenCalledWith('/repo/crate', '0.2.0', ['/repo/other']);
  });

  it('names the path when Cargo.toml is missing', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    await expect(cratesWriteVersion({ path: '/repo/crate' }, '0.2.0', ctx)).rejects.toThrow(
      `Cargo.toml not found at ${cargoPath}`,
    );
  });

  it('rethrows other read errors as-is', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(cratesWriteVersion({ path: '/repo/crate' }, '0.2.0', ctx)).rejects.toThrow(/^denied$/);
  });

  it('normalizes a non-Error thrown by the resolver', async () => {
    resolvedMock.mockRejectedValue('no version source');
    await expect(cratesWriteVersion({ path: '/repo/crate' }, '0.2.0', ctx)).rejects.toThrow(
      /^no version source$/,
    );
    expect(depsMock).not.toHaveBeenCalled();
  });
});
