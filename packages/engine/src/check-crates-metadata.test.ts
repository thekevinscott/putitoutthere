import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'smol-toml';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCratesMetadata } from './check-crates-metadata.js';
import type { Package } from './config.js';
import { nonEmptyString, readWorkspacePackageTable, resolveInherited } from './preflight.js';

vi.mock('node:fs/promises');
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./preflight.js');
vi.mock('smol-toml', async () => {
  const actual = await vi.importActual<typeof import('smol-toml')>('smol-toml');
  return { ...actual, parse: vi.fn(actual.parse) };
});

const readFileMock = vi.mocked(readFile);
const wsTableMock = vi.mocked(readWorkspacePackageTable);
const resolveMock = vi.mocked(resolveInherited);
const nonEmptyMock = vi.mocked(nonEmptyString);
const parseMock = vi.mocked(parse);

const cargoTomlPath = join('/repo/crate', 'Cargo.toml');

function crate(name = 'widget', path = '/repo/crate'): Package {
  return { name, kind: 'crates', path, globs: ['**'], depends_on: [], first_version: '0.1.0' } as unknown as Package;
}

function manifest(text: string): void {
  readFileMock.mockResolvedValue(text);
}

beforeEach(() => {
  readFileMock.mockReset();
  parseMock.mockClear();
  wsTableMock.mockReset().mockResolvedValue(undefined);
  resolveMock.mockReset().mockImplementation((value) => value);
  nonEmptyMock.mockReset().mockImplementation((v) => typeof v === 'string' && v.length > 0);
});

describe('checkCratesMetadata', () => {
  it('skips packages that are not crates without reading anything', async () => {
    const npm = { ...crate(), kind: 'npm' } as unknown as Package;
    await expect(checkCratesMetadata([npm])).resolves.toEqual([]);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('reads Cargo.toml under the package path as utf8', async () => {
    manifest('[package]\ndescription = "d"\nlicense = "MIT"\n');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([]);
    expect(readFileMock).toHaveBeenCalledWith(cargoTomlPath, 'utf8');
  });

  it('skips a crate whose Cargo.toml cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([]);
    expect(parseMock).not.toHaveBeenCalled();
    expect(wsTableMock).not.toHaveBeenCalled();
  });

  it('skips a crate whose Cargo.toml is not valid TOML', async () => {
    manifest('[[broken');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([]);
    expect(wsTableMock).not.toHaveBeenCalled();
  });

  it('resolves each field against the workspace package table of the crate dir', async () => {
    const ws = { license: 'MIT' };
    wsTableMock.mockResolvedValue(ws);
    manifest('[package]\ndescription = "d"\nlicense = { workspace = true }\nlicense-file = "L"\n');
    await checkCratesMetadata([crate()]);
    expect(wsTableMock).toHaveBeenCalledWith('/repo/crate');
    expect(resolveMock.mock.calls).toEqual([
      ['d', ws, 'description'],
      [{ workspace: true }, ws, 'license'],
      ['L', ws, 'license-file'],
    ]);
  });

  it('reports both fields when the manifest has no [package] table', async () => {
    manifest('[lib]\n');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([
      { package: 'widget', cargoTomlPath, missing: ['description', 'license'] },
    ]);
  });

  it('reports a missing description alone', async () => {
    manifest('[package]\nlicense = "MIT"\n');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([
      { package: 'widget', cargoTomlPath, missing: ['description'] },
    ]);
  });

  it('reports license when neither license nor license-file resolves', async () => {
    manifest('[package]\ndescription = "d"\n');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([
      { package: 'widget', cargoTomlPath, missing: ['license'] },
    ]);
  });

  it('accepts license-file in place of license', async () => {
    manifest('[package]\ndescription = "d"\nlicense-file = "LICENSE"\n');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([]);
  });

  it('judges emptiness through nonEmptyString', async () => {
    nonEmptyMock.mockReturnValue(false);
    manifest('[package]\ndescription = "d"\nlicense = "MIT"\n');
    await expect(checkCratesMetadata([crate()])).resolves.toEqual([
      { package: 'widget', cargoTomlPath, missing: ['description', 'license'] },
    ]);
  });

  it('reports every failing crate, not just the first', async () => {
    manifest('[package]\n');
    const findings = await checkCratesMetadata([crate('a', '/r/a'), crate('b', '/r/b')]);
    expect(findings.map((f) => f.package)).toEqual(['a', 'b']);
  });
});
