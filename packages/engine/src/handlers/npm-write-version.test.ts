import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { npmWriteVersion } from './npm-write-version.js';

vi.mock('node:fs/promises');

const readMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);
const ctx = {} as Ctx;
const pkg = { name: 'pkg', path: '/repo/pkg' };
const manifest = join('/repo/pkg', 'package.json');

beforeEach(() => {
  readMock.mockReset();
  writeMock.mockReset().mockResolvedValue(undefined);
});

describe('npmWriteVersion', () => {
  it('rewrites the version, keeping indent and trailing newline', async () => {
    readMock.mockResolvedValue('{\n    "name": "pkg",\n    "version": "0.1.0"\n}\n');
    await expect(npmWriteVersion(pkg, '0.2.0', ctx)).resolves.toEqual([manifest]);
    expect(readMock).toHaveBeenCalledWith(manifest, 'utf8');
    expect(writeMock).toHaveBeenCalledWith(
      manifest,
      '{\n    "name": "pkg",\n    "version": "0.2.0"\n}\n',
      'utf8',
    );
  });

  it('adds no trailing newline the source lacked', async () => {
    readMock.mockResolvedValue('{\n  "version": "0.1.0"\n}');
    await npmWriteVersion(pkg, '0.2.0', ctx);
    expect(writeMock).toHaveBeenCalledWith(manifest, '{\n  "version": "0.2.0"\n}', 'utf8');
  });

  it('writes nothing when the version already matches', async () => {
    readMock.mockResolvedValue('{"version":"0.2.0"}');
    await expect(npmWriteVersion(pkg, '0.2.0', ctx)).resolves.toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('names the path when package.json is missing', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    await expect(npmWriteVersion(pkg, '0.2.0', ctx)).rejects.toThrow(
      `package.json not found at ${manifest}`,
    );
  });

  it('rethrows other read errors as-is', async () => {
    readMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(npmWriteVersion(pkg, '0.2.0', ctx)).rejects.toThrow(/^denied$/);
  });

  it('reports a JSON parse error', async () => {
    readMock.mockResolvedValue('{not json');
    await expect(npmWriteVersion(pkg, '0.2.0', ctx)).rejects.toThrow(
      /^package\.json JSON parse error: /,
    );
  });
});
