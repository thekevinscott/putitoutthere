import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bare automocks (no factory) isolate the unit under test: the resolve/
// download collaborators, the recursive-listing and local-diagnostic
// helpers, and `node:fs` are all driven directly, so no real registry,
// temp dirs, or source trees are touched. Real download/IO round-tripping
// is covered by test/integration/verify-npm-tarball.integration.test.ts and
// the e2e tier.
vi.mock('./resolve-url.js');
vi.mock('./download.js');
vi.mock('./local-dir-state.js');
vi.mock('../../utils/list-files-recursive.js');
vi.mock('node:fs');

import { downloadNpmTarball } from './download.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import { localDirState } from './local-dir-state.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { verifyNpmTarballMain } from './main.js';

const resolveMock = vi.mocked(resolveNpmTarballUrl);
const downloadMock = vi.mocked(downloadNpmTarball);
const localDirStateMock = vi.mocked(localDirState);
const listMock = vi.mocked(listFilesRecursive);
const readFileMock = vi.mocked(readFileSync);
const existsMock = vi.mocked(existsSync);
const statMock = vi.mocked(statSync);

// `downloadNpmTarball`'s return is opaque here — the four tarball shapes are
// expressed through the mocked fs/listing responses, not a real extraction.
const TARBALL = { root: 'tarball-root', packageDir: 'tarball-root/package' };

// `localDirState` is a mocked collaborator; its output is passed through
// `main` verbatim, so these literals are asserted identically on every OS.
const PRESENT_DIAG = 'local packages/npm/dist: present, 1 file(s) — packages/npm/dist/index.js ';
const MISSING_DIAG = 'local packages/npm/dist: missing';

const out: string[] = [];

const row = { name: '@scope/pkg', kind: 'npm', version: '1.0.0', target: 'main', path: 'packages/npm' };

/** The package.json JSON the mocked `readFileSync` hands back. */
function pkgJson(files?: string[]): string {
  return JSON.stringify(files === undefined ? { name: '@scope/pkg' } : { name: '@scope/pkg', files });
}

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

describe('verifyNpmTarballMain', () => {
  it('returns 0 and reports nothing to verify when no npm main/noarch rows', async () => {
    const code = await verifyNpmTarballMain([{ ...row, kind: 'crates' }], { cwd: '/cwd', matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain('No npm main/noarch rows; nothing to verify.');
    expect(code).toBe(0);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('skips rows whose files[] has no directory entries', async () => {
    readFileMock.mockReturnValue(pkgJson(['README.md']));
    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain('[@scope/pkg@1.0.0] no directory entries in files[]; skipping.');
    expect(code).toBe(0);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('passes when every declared dir is present in the tarball', async () => {
    readFileMock.mockReturnValue(pkgJson(['dist']));
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(TARBALL);
    existsMock.mockReturnValue(true);
    statMock.mockReturnValue({ isDirectory: () => true } as never);
    listMock.mockReturnValue(['tarball-root/package/dist/index.js']);

    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '', registry: 'http://localhost:4873' });
    const text = out.join('');
    expect(text).toContain('verifying tarball at http://localhost:4873 contains: dist');
    expect(text).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
  });

  it('fails with a present-locally diagnostic when the tarball drops a dir', async () => {
    readFileMock.mockReturnValue(pkgJson(['dist']));
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(TARBALL);
    existsMock.mockReturnValue(false); // tarball target absent
    localDirStateMock.mockReturnValue(PRESENT_DIAG);

    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '', registry: 'http://r' });
    const text = out.join('');
    expect(text).toContain("tarball missing 'dist'");
    expect(text).toContain(PRESENT_DIAG);
    expect(code).toBe(1);
  });

  it('fails with a missing diagnostic when the dir is absent locally too', async () => {
    readFileMock.mockReturnValue(pkgJson(['dist']));
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(TARBALL);
    existsMock.mockReturnValue(false);
    localDirStateMock.mockReturnValue(MISSING_DIAG);

    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain(MISSING_DIAG);
    expect(code).toBe(1);
  });

  it('fails when the declared dir is present but empty in the tarball', async () => {
    readFileMock.mockReturnValue(pkgJson(['dist']));
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(TARBALL);
    existsMock.mockReturnValue(true);
    statMock.mockReturnValue({ isDirectory: () => true } as never);
    listMock.mockReturnValue([]); // present dir, but no files under it
    localDirStateMock.mockReturnValue(MISSING_DIAG);

    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain("tarball missing 'dist'");
    expect(code).toBe(1);
  });

  it('fails when the declared dir exists as a file in the tarball', async () => {
    readFileMock.mockReturnValue(pkgJson(['dist']));
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(TARBALL);
    existsMock.mockReturnValue(true);
    statMock.mockReturnValue({ isDirectory: () => false } as never); // it's a file
    localDirStateMock.mockReturnValue(MISSING_DIAG);

    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain("tarball missing 'dist'");
    expect(code).toBe(1);
  });

  it('selects noarch npm rows, ignores other kinds/targets, defaults an absent files[]', async () => {
    // package.json without a `files` key → the `files ?? []` default.
    readFileMock.mockReturnValue(pkgJson(undefined));
    const rows = [
      { ...row, kind: 'crates' },          // non-npm → filtered
      { ...row, target: 'noarch' },        // npm noarch → selected
      { ...row, target: 'linux-x64-gnu' }, // npm per-triple → filtered here
    ];
    const code = await verifyNpmTarballMain(rows, { cwd: '/cwd', matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain('no directory entries in files[]; skipping.');
    expect(code).toBe(0);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('uses the real-npm label and fails when no URL ever resolves', async () => {
    readFileMock.mockReturnValue(pkgJson(['dist']));
    resolveMock.mockResolvedValue(null);

    // No `registry` → real npm; label is registry.npmjs.org, 6 attempts.
    const code = await verifyNpmTarballMain([row], { cwd: '/cwd', matrix: '' });
    const text = out.join('');
    expect(text).toContain('npm view at registry.npmjs.org never returned a tarball URL after 6 attempts');
    expect(code).toBe(1);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
