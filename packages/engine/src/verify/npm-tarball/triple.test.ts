import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bare automocks (no factory) isolate the unit under test: the resolve/
// download collaborators, the recursive-listing helper, and
// `node:fs/promises` are driven directly, so no real registry, temp dirs, or
// extraction happen. Real download/IO round-tripping is covered by
// tests/integration/verify-npm-tarball.integration.test.ts and the e2e tier.
vi.mock('./resolve-url.js');
vi.mock('./download.js');
vi.mock('../../utils/list-files-recursive.js');
vi.mock('node:fs/promises');

import { downloadNpmTarball } from './download.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { verifyNpmTarballTriple } from './triple.js';

const resolveMock = vi.mocked(resolveNpmTarballUrl);
const downloadMock = vi.mocked(downloadNpmTarball);
const listMock = vi.mocked(listFilesRecursive);

const out: string[] = [];

// `downloadNpmTarball`'s return is opaque here — the tarball's contents are
// expressed through the mocked `listFilesRecursive` response, whose absolute
// paths the unit under test reports relative to `packageDir`.
const TARBALL = { root: 'tarball-root', packageDir: 'tarball-root/package' };

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
    downloadMock.mockResolvedValue(TARBALL);
    listMock.mockResolvedValue([
      'tarball-root/package/package.json',
      'tarball-root/package/pkg.linux-x64-gnu.node',
    ]);

    const code = await verifyNpmTarballTriple([row], opts);
    const text = out.join('');
    // Name reconstructed as {name}-{triple}.
    expect(text).toContain('[@scope/pkg-linux-x64-gnu@1.0.0] verifying tarball at http://localhost:4873');
    expect(text).toContain('ok: 1 non-metadata file(s): pkg.linux-x64-gnu.node');
    expect(code).toBe(0);
    // The listing is taken from the extracted `package/` dir, not the temp root.
    expect(listMock).toHaveBeenCalledWith(TARBALL.packageDir);
    // The downloaded tarball's temp root is cleaned up recursively/forcefully.
    expect(vi.mocked(rm)).toHaveBeenCalledWith(expect.anything(), { recursive: true, force: true });
  });

  it('counts a payload nested below the top level (#633)', async () => {
    // A bundled-cli consumer stages `artifacts/<name>-<triple>/bin/<binary>`
    // rather than flat, so the tarball's top level is `package.json` plus a
    // `bin/` DIRECTORY. Counting only top-level files reads that as
    // metadata-only and fails a tarball whose binary is right there at
    // `package/bin/` — the recursive listing is the one that sees it.
    resolveMock.mockResolvedValue('https://reg/triple.tgz');
    downloadMock.mockResolvedValue(TARBALL);
    // Two payload files under different directories: pins the recursive
    // count and the space separator the listing joins on.
    listMock.mockResolvedValue([
      'tarball-root/package/package.json',
      'tarball-root/package/bin/pkg-linux-x64-gnu',
      'tarball-root/package/lib/pkg.node',
    ]);

    const code = await verifyNpmTarballTriple([row], opts);
    const text = out.join('');
    // Reported relative to `package/`, so the nested path is legible —
    // a basename alone wouldn't say where the binary landed.
    expect(text).toContain('ok: 2 non-metadata file(s): bin/pkg-linux-x64-gnu lib/pkg.node');
    expect(code).toBe(0);
  });

  it('fails when the tarball carries only package.json', async () => {
    resolveMock.mockResolvedValue('https://reg/triple.tgz');
    downloadMock.mockResolvedValue(TARBALL);
    // Genuinely metadata-only: an empty `bin/` contributes no files, so the
    // recursive walk finds the `package.json` and nothing else.
    listMock.mockResolvedValue(['tarball-root/package/package.json']);

    const code = await verifyNpmTarballTriple([row], opts);
    const text = out.join('');
    expect(text).toContain(
      '::error::[@scope/pkg-linux-x64-gnu@1.0.0] tarball contains only package.json (no synthesized binary/.node staged).\n',
    );
    // No trailing listing: one walk decides the verdict, and reaching here
    // means it found nothing a listing could add. The pre-#633 message
    // appended one from a second walk and so named the binary it had just
    // called absent.
    expect(text).not.toContain('Tarball contents');
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
