import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { defaultRunsOn } from './default-runs-on.js';
import { resolvePythonVersions } from './python-versions.js';
import { rowsForPackage } from './rows-for-package.js';
import { isVersionIndependentWheel } from './wheel-abi.js';

vi.mock('./default-runs-on.js');
vi.mock('./python-versions.js');
vi.mock('./wheel-abi.js');

const bundleCli = { bin: 'tool', crate_path: 'crates/tool', features: [], no_default_features: false };

function pkg(fields: Record<string, unknown>): Package {
  return { name: 'scope/lib', path: 'pkgs/lib', ...fields } as unknown as Package;
}

beforeEach(() => {
  vi.mocked(defaultRunsOn).mockReset().mockImplementation((t) => `runner-for-${t}`);
  vi.mocked(resolvePythonVersions).mockReset().mockResolvedValue(['3.11', '3.12']);
  vi.mocked(isVersionIndependentWheel).mockReset().mockResolvedValue(false);
});

describe('rowsForPackage', () => {
  it('emits one noarch crate row with a sanitized artifact name', async () => {
    const rows = await rowsForPackage(pkg({ kind: 'crates', path: '.' }), '1.2.3', '/repo');
    expect(rows).toEqual([
      {
        name: 'scope/lib',
        kind: 'crates',
        version: '1.2.3',
        target: 'noarch',
        runs_on: 'ubuntu-latest',
        artifact_name: 'scope__lib-crate',
        artifact_path: 'target/package',
        path: '.',
      },
    ]);
  });

  it('fans maturin wheels across targets and python versions, then adds the sdist', async () => {
    const p = pkg({
      kind: 'pypi',
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu', { triple: 'aarch64-apple-darwin', runner: 'macos-14' }],
      bundle_cli: bundleCli,
      manylinux: 'manylinux_2_28',
    });
    const rows = await rowsForPackage(p, '1.0.0', '/repo');
    expect(resolvePythonVersions).toHaveBeenCalledWith(p, '/repo');
    expect(isVersionIndependentWheel).toHaveBeenCalledWith('pkgs/lib', '/repo');
    expect(rows.map((r) => [r.target, r.runs_on, r.artifact_name, r.python_version, r.manylinux])).toEqual([
      ['x86_64-unknown-linux-gnu', 'runner-for-x86_64-unknown-linux-gnu', 'scope__lib-wheel-x86_64-unknown-linux-gnu-py3.11', '3.11', 'manylinux_2_28'],
      ['x86_64-unknown-linux-gnu', 'runner-for-x86_64-unknown-linux-gnu', 'scope__lib-wheel-x86_64-unknown-linux-gnu-py3.12', '3.12', 'manylinux_2_28'],
      ['aarch64-apple-darwin', 'macos-14', 'scope__lib-wheel-aarch64-apple-darwin-py3.11', '3.11', undefined],
      ['aarch64-apple-darwin', 'macos-14', 'scope__lib-wheel-aarch64-apple-darwin-py3.12', '3.12', undefined],
      ['sdist', 'ubuntu-latest', 'scope__lib-sdist', '3.12', undefined],
    ]);
    expect(rows.slice(0, 4).every((r) => r.bundle_cli === bundleCli && r.artifact_path === 'pkgs/lib/dist')).toBe(true);
    expect(rows[4]).not.toHaveProperty('bundle_cli');
    expect(rows[4]!.build).toBe('maturin');
    expect(rows.every((r) => r.kind === 'pypi')).toBe(true);
  });

  it('emits only the sdist for a maturin package with no targets', async () => {
    const rows = await rowsForPackage(pkg({ kind: 'pypi', build: 'maturin' }), '1.0.0', '/repo');
    expect(rows.map((r) => r.target)).toEqual(['sdist']);
  });

  it('collapses a version-independent maturin wheel to the newest interpreter', async () => {
    vi.mocked(isVersionIndependentWheel).mockResolvedValue(true);
    const p = pkg({ kind: 'pypi', build: 'maturin', targets: ['x86_64-unknown-linux-gnu'] });
    const rows = await rowsForPackage(p, '1.0.0', '/repo');
    expect(rows.map((r) => [r.artifact_name, r.python_version])).toEqual([
      ['scope__lib-wheel-x86_64-unknown-linux-gnu', '3.12'],
      ['scope__lib-sdist', '3.12'],
    ]);
    expect(rows[0]).not.toHaveProperty('bundle_cli');
  });

  it('emits sdist plus wheel-any for hatch, ignoring targets, without probing the wheel ABI', async () => {
    const p = pkg({ kind: 'pypi', build: 'hatch', targets: ['x86_64-unknown-linux-gnu'] });
    const rows = await rowsForPackage(p, '1.0.0', '/repo');
    expect(isVersionIndependentWheel).not.toHaveBeenCalled();
    expect(rows.map((r) => [r.kind, r.target, r.artifact_name, r.build, r.python_version])).toEqual([
      ['pypi', 'sdist', 'scope__lib-sdist', 'hatch', '3.12'],
      ['pypi', 'any', 'scope__lib-wheel-any', 'hatch', '3.12'],
    ]);
  });

  it('emits a single noarch row for vanilla npm', async () => {
    const rows = await rowsForPackage(pkg({ kind: 'npm' }), '2.0.0', '/repo');
    expect(rows).toEqual([
      {
        name: 'scope/lib',
        kind: 'npm',
        version: '2.0.0',
        target: 'noarch',
        runs_on: 'ubuntu-latest',
        artifact_name: 'scope__lib-pkg',
        artifact_path: 'pkgs/lib/package.json',
        path: 'pkgs/lib',
      },
    ]);
  });

  it('infixes the mode on multi-mode npm rows and resolves rust_target for bundled-cli only', async () => {
    const p = pkg({
      kind: 'npm',
      build: ['napi', 'bundled-cli'],
      targets: ['linux-x64-gnu'],
      bundle_cli: bundleCli,
    });
    const rows = await rowsForPackage(p, '2.0.0', '/repo');
    expect(rows.map((r) => [r.target, r.build, r.artifact_name, r.artifact_path, r.rust_target])).toEqual([
      ['linux-x64-gnu', 'napi', 'scope__lib-napi-linux-x64-gnu', 'pkgs/lib/build/napi-linux-x64-gnu', undefined],
      ['linux-x64-gnu', 'bundled-cli', 'scope__lib-bundled-cli-linux-x64-gnu', 'pkgs/lib/build/bundled-cli-linux-x64-gnu', 'x86_64-unknown-linux-gnu'],
      ['main', 'napi', 'scope__lib-main', 'pkgs/lib/package.json', undefined],
    ]);
    expect(rows[1]!.bundle_cli).toBe(bundleCli);
    expect(rows[0]).not.toHaveProperty('bundle_cli');
    expect(rows.every((r) => r.kind === 'npm')).toBe(true);
  });

  it('emits only the main row for a built npm package with no targets', async () => {
    const rows = await rowsForPackage(pkg({ kind: 'npm', build: 'napi' }), '2.0.0', '/repo');
    expect(rows.map((r) => [r.target, r.build])).toEqual([['main', 'napi']]);
  });

  it('leaves bundled-cli rows bare when no bundle_cli block is configured', async () => {
    const p = pkg({ kind: 'npm', build: 'bundled-cli', targets: ['linux-x64-gnu'] });
    const [row] = await rowsForPackage(p, '2.0.0', '/repo');
    expect(row).not.toHaveProperty('bundle_cli');
    expect(row).not.toHaveProperty('rust_target');
  });

  it('rejects an unmapped npm triple before emitting any row', async () => {
    const p = pkg({ kind: 'npm', build: 'napi', targets: ['plan9-mips'] });
    await expect(rowsForPackage(p, '2.0.0', '/repo')).rejects.toThrow();
  });
});
