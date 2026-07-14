import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bare automocks (no factory) isolate the unit under test: the resolve/
// download collaborators, the recursive-listing helper, and `node:fs` are
// driven directly, so no real registry, temp dirs, or extraction happen.
// Real download/IO round-tripping is covered by
// tests/integration/verify-npm-tarball.integration.test.ts and the e2e tier.
vi.mock('./resolve-url.js');
vi.mock('./download.js');
vi.mock('../../utils/list-files-recursive.js');
vi.mock('node:fs');

import { downloadNpmTarball } from './download.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { verifyNpmTarballTriple } from './triple.js';

const resolveMock = vi.mocked(resolveNpmTarballUrl);
const downloadMock = vi.mocked(downloadNpmTarball);
const listMock = vi.mocked(listFilesRecursive);
const readdirMock = vi.mocked(readdirSync);

const out: string[] = [];

// `downloadNpmTarball`'s return is opaque here — the tarball's top-level
// contents are expressed through the mocked `readdirSync` response.
const TARBALL = { root: 'tarball-root', packageDir: 'tarball-root/package' };

/** A fake `readdirSync(..., { withFileTypes: true })` file entry. */
function entry(name: string): { isFile: () => boolean; name: string } {
  return { isFile: () => true, name };
}

const row = { name: '@scope/pkg', kind: 'npm', version: '1.0.0', target: 'linux-x64-gnu', path: 'packages/npm' };
const opts = { cwd: '/unused', matrix: '', registry: 'http://localhost:4873' };

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyNpmTarballTriple', () => {
  it('returns 0 and reports nothing to verify when no per-triple rows', async () => {
    const code = await verifyNpmTarballTriple([{ ...row, target: 'main' }], opts);
    expect(out.join('')).toContain('No npm per-triple rows; nothing to verify.');
    expect(code).toBe(0);
  });

  it('passes when the platform tarball ships a non-metadata file', async () => {
    resolveMock.mockResolvedValue('https://reg/triple.tgz');
    downloadMock.mockReturnValue(TARBALL);
    readdirMock.mockReturnValue([entry('package.json'), entry('pkg.linux-x64-gnu.node')] as never);

    const code = await verifyNpmTarballTriple([row], opts);
    const text = out.join('');
    // Name reconstructed as {name}-{triple}.
    expect(text).toContain('[@scope/pkg-linux-x64-gnu@1.0.0] verifying tarball at http://localhost:4873');
    expect(text).toContain('ok: 1 non-metadata file(s): pkg.linux-x64-gnu.node');
    expect(code).toBe(0);
  });

  it('fails when the tarball carries only package.json', async () => {
    resolveMock.mockResolvedValue('https://reg/triple.tgz');
    downloadMock.mockReturnValue(TARBALL);
    readdirMock.mockReturnValue([entry('package.json')] as never);
    // `basename` of this path is 'package.json' on every OS.
    listMock.mockReturnValue(['tarball-root/package/package.json']);

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
