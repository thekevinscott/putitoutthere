import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./resolve-url.js', () => ({ resolveNpmTarballUrl: vi.fn() }));
vi.mock('./download.js', () => ({ downloadNpmTarball: vi.fn() }));

import { downloadNpmTarball } from './download.js';
import { resolveNpmTarballUrl } from './resolve-url.js';
import { verifyNpmTarballMain } from './main.js';

const resolveMock = vi.mocked(resolveNpmTarballUrl);
const downloadMock = vi.mocked(downloadNpmTarball);

let cwd: string;
const roots: string[] = [];
const out: string[] = [];

type DistShape = 'files' | 'empty' | 'file' | 'absent';

/** A fake unpacked tarball whose `package/dist` takes one of four shapes. */
function fakeTarball(dist: DistShape): { root: string; packageDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'tb-'));
  roots.push(root);
  const packageDir = join(root, 'package');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{}');
  if (dist === 'files') {
    mkdirSync(join(packageDir, 'dist'));
    writeFileSync(join(packageDir, 'dist', 'index.js'), '');
  } else if (dist === 'empty') {
    mkdirSync(join(packageDir, 'dist'));
  } else if (dist === 'file') {
    writeFileSync(join(packageDir, 'dist'), 'not a dir');
  }
  return { root, packageDir };
}

function writePkgJson(files: string[]): void {
  mkdirSync(join(cwd, 'packages/npm'), { recursive: true });
  writeFileSync(join(cwd, 'packages/npm/package.json'), JSON.stringify({ name: '@scope/pkg', files }));
}

const row = { name: '@scope/pkg', kind: 'npm', version: '1.0.0', target: 'main', path: 'packages/npm' };

beforeEach(() => {
  resolveMock.mockReset();
  downloadMock.mockReset();
  cwd = mkdtempSync(join(tmpdir(), 'main-cwd-'));
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
  for (const r of roots.splice(0)) {rmSync(r, { recursive: true, force: true });}
});

describe('verifyNpmTarballMain', () => {
  it('returns 0 and reports nothing to verify when no npm main/noarch rows', async () => {
    const code = await verifyNpmTarballMain([{ ...row, kind: 'crates' }], { cwd, matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain('No npm main/noarch rows; nothing to verify.');
    expect(code).toBe(0);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('skips rows whose files[] has no directory entries', async () => {
    writePkgJson(['README.md']);
    const code = await verifyNpmTarballMain([row], { cwd, matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain('[@scope/pkg@1.0.0] no directory entries in files[]; skipping.');
    expect(code).toBe(0);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('passes when every declared dir is present in the tarball', async () => {
    writePkgJson(['dist']);
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(fakeTarball('files'));

    const code = await verifyNpmTarballMain([row], { cwd, matrix: '', registry: 'http://localhost:4873' });
    const text = out.join('');
    expect(text).toContain('verifying tarball at http://localhost:4873 contains: dist');
    expect(text).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
  });

  it('fails with a present-locally diagnostic when the tarball drops a dir', async () => {
    writePkgJson(['dist']);
    mkdirSync(join(cwd, 'packages/npm/dist'));
    writeFileSync(join(cwd, 'packages/npm/dist/index.js'), '');
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(fakeTarball('absent'));

    const code = await verifyNpmTarballMain([row], { cwd, matrix: '', registry: 'http://r' });
    const text = out.join('');
    expect(text).toContain("tarball missing 'dist'");
    expect(text).toContain(`local ${join(cwd, 'packages/npm/dist')}: present, 1 file(s)`);
    expect(code).toBe(1);
  });

  it('fails with a missing diagnostic when the dir is absent locally too', async () => {
    writePkgJson(['dist']);
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(fakeTarball('absent'));

    const code = await verifyNpmTarballMain([row], { cwd, matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain(`local ${join(cwd, 'packages/npm/dist')}: missing`);
    expect(code).toBe(1);
  });

  it('fails when the declared dir is present but empty in the tarball', async () => {
    writePkgJson(['dist']);
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(fakeTarball('empty'));

    const code = await verifyNpmTarballMain([row], { cwd, matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain("tarball missing 'dist'");
    expect(code).toBe(1);
  });

  it('fails when the declared dir exists as a file in the tarball', async () => {
    writePkgJson(['dist']);
    resolveMock.mockResolvedValue('https://reg/pkg.tgz');
    downloadMock.mockReturnValue(fakeTarball('file'));

    const code = await verifyNpmTarballMain([row], { cwd, matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain("tarball missing 'dist'");
    expect(code).toBe(1);
  });

  it('selects noarch npm rows, ignores other kinds/targets, defaults an absent files[]', async () => {
    // package.json without a `files` key → the `files ?? []` default.
    mkdirSync(join(cwd, 'packages/npm'), { recursive: true });
    writeFileSync(join(cwd, 'packages/npm/package.json'), JSON.stringify({ name: '@scope/pkg' }));
    const rows = [
      { ...row, kind: 'crates' },          // non-npm → filtered
      { ...row, target: 'noarch' },        // npm noarch → selected
      { ...row, target: 'linux-x64-gnu' }, // npm per-triple → filtered here
    ];
    const code = await verifyNpmTarballMain(rows, { cwd, matrix: '', registry: 'http://r' });
    expect(out.join('')).toContain('no directory entries in files[]; skipping.');
    expect(code).toBe(0);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('uses the real-npm label and fails when no URL ever resolves', async () => {
    writePkgJson(['dist']);
    resolveMock.mockResolvedValue(null);

    // No `registry` → real npm; label is registry.npmjs.org, 6 attempts.
    const code = await verifyNpmTarballMain([row], { cwd, matrix: '' });
    const text = out.join('');
    expect(text).toContain('npm view at registry.npmjs.org never returned a tarball URL after 6 attempts');
    expect(code).toBe(1);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
