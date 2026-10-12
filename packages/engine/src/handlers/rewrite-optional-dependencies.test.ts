import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectIndent } from './detect-indent.js';
import type { PlatformPkg } from './npm-platform.js';
import { rewriteOptionalDependencies } from './rewrite-optional-dependencies.js';

vi.mock('node:fs/promises');
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./detect-indent.js');

const readFileMock = vi.mocked(readFile);
const writeFileMock = vi.mocked(writeFile);
const detectIndentMock = vi.mocked(detectIndent);

const pkg: PlatformPkg = { name: 'demo', path: '/repo/js', build: [], targets: [] };
const manifest = join('/repo/js', 'package.json');

function written(): string {
  return writeFileMock.mock.calls[0]![1] as string;
}

beforeEach(() => {
  readFileMock.mockReset();
  writeFileMock.mockReset();
  detectIndentMock.mockReset();
  detectIndentMock.mockReturnValue(2);
});

describe('rewriteOptionalDependencies', () => {
  it('pins every platform package at the version, merged over existing entries', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({ name: 'demo', optionalDependencies: { keep: '1.0.0', 'demo-a': '0.0.1' } }),
    );
    await rewriteOptionalDependencies(pkg, '2.0.0', ['demo-a', 'demo-b']);
    expect(readFileMock).toHaveBeenCalledWith(manifest, 'utf8');
    expect(writeFileMock).toHaveBeenCalledWith(manifest, expect.any(String), 'utf8');
    expect(JSON.parse(written())).toEqual({
      name: 'demo',
      optionalDependencies: { keep: '1.0.0', 'demo-a': '2.0.0', 'demo-b': '2.0.0' },
    });
  });

  it('adds optionalDependencies when the manifest has none', async () => {
    readFileMock.mockResolvedValue('{"name":"demo"}');
    await rewriteOptionalDependencies(pkg, '1.2.3', ['demo-a']);
    expect(JSON.parse(written())).toEqual({ name: 'demo', optionalDependencies: { 'demo-a': '1.2.3' } });
  });

  it('keeps the source indent and trailing newline', async () => {
    const raw = '{\n\t"name": "demo"\n}\n';
    readFileMock.mockResolvedValue(raw);
    detectIndentMock.mockReturnValue('\t');
    await rewriteOptionalDependencies(pkg, '1.0.0', []);
    expect(detectIndentMock).toHaveBeenCalledWith(raw);
    expect(written()).toBe('{\n\t"name": "demo",\n\t"optionalDependencies": {}\n}\n');
  });

  it('adds no trailing newline when the source had none', async () => {
    readFileMock.mockResolvedValue('{"name":"demo"}');
    await rewriteOptionalDependencies(pkg, '1.0.0', []);
    expect(written()).toBe('{\n  "name": "demo",\n  "optionalDependencies": {}\n}');
  });
});
