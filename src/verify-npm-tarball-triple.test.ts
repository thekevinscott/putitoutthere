import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./resolve-npm-tarball-url.js', () => ({ resolveNpmTarballUrl: vi.fn() }));
vi.mock('./download-npm-tarball.js', () => ({ downloadNpmTarball: vi.fn() }));

import { downloadNpmTarball } from './download-npm-tarball.js';
import { resolveNpmTarballUrl } from './resolve-npm-tarball-url.js';
import { verifyNpmTarballTriple } from './verify-npm-tarball-triple.js';

const resolveMock = vi.mocked(resolveNpmTarballUrl);
const downloadMock = vi.mocked(downloadNpmTarball);

const roots: string[] = [];
const out: string[] = [];

function fakeTarball(withBinary: boolean): { root: string; packageDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'tri-'));
  roots.push(root);
  const packageDir = join(root, 'package');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{}');
  if (withBinary) {writeFileSync(join(packageDir, 'pkg.linux-x64-gnu.node'), 'ELF');}
  return { root, packageDir };
}

const row = { name: '@scope/pkg', kind: 'npm', version: '1.0.0', target: 'linux-x64-gnu', path: 'packages/npm' };
const opts = { cwd: '/unused', matrix: '', registry: 'http://localhost:4873' };

beforeEach(() => {
  resolveMock.mockReset();
  downloadMock.mockReset();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) {rmSync(r, { recursive: true, force: true });}
});

describe('verifyNpmTarballTriple', () => {
  it('returns 0 and reports nothing to verify when no per-triple rows', async () => {
    const code = await verifyNpmTarballTriple([{ ...row, target: 'main' }], opts);
    expect(out.join('')).toContain('No npm per-triple rows; nothing to verify.');
    expect(code).toBe(0);
  });

  it('passes when the platform tarball ships a non-metadata file', async () => {
    resolveMock.mockResolvedValue('https://reg/triple.tgz');
    downloadMock.mockReturnValue(fakeTarball(true));

    const code = await verifyNpmTarballTriple([row], opts);
    const text = out.join('');
    // Name reconstructed as {name}-{triple}.
    expect(text).toContain('[@scope/pkg-linux-x64-gnu@1.0.0] verifying tarball at http://localhost:4873');
    expect(text).toContain('ok: 1 non-metadata file(s): pkg.linux-x64-gnu.node');
    expect(code).toBe(0);
  });

  it('fails when the tarball carries only package.json', async () => {
    resolveMock.mockResolvedValue('https://reg/triple.tgz');
    downloadMock.mockReturnValue(fakeTarball(false));

    const code = await verifyNpmTarballTriple([row], opts);
    const text = out.join('');
    expect(text).toContain('tarball contains only package.json (no synthesized binary/.node staged)');
    expect(text).toContain('Tarball contents: package.json');
    expect(code).toBe(1);
  });

  it('fails when no URL ever resolves', async () => {
    resolveMock.mockResolvedValue(null);
    const code = await verifyNpmTarballTriple([row], opts);
    expect(out.join('')).toContain('npm view at http://localhost:4873 never returned a tarball URL');
    expect(code).toBe(1);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
