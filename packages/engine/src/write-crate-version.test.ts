/**
 * Unit tests for `writeCrateVersionForBuild` (#366).
 *
 * `node:fs` and the workspace-root walk (`findWorkspaceRoot`, itself an fs
 * collaborator) are mocked so each case isolates the read-manifest / route /
 * error branches; the pure `replaceCargoVersion` string rewriter runs for
 * real. Real on-disk manifest round-trips are covered by the integration +
 * e2e tiers.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { writeCrateVersionForBuild } from './write-crate-version.js';

vi.mock('node:fs/promises');
vi.mock('./find-workspace-root.js');

const readFileMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);
const findRootMock = vi.mocked(findWorkspaceRoot);

const ENOENT = (): Promise<never> =>
  Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writeCrateVersionForBuild (#366)', () => {
  it('rewrites [package].version to the planned version', async () => {
    readFileMock.mockResolvedValue(
      ['[package]', 'name = "dirsql"', 'version = "0.2.7"', 'edition = "2021"', ''].join('\n'),
    );
    const written = await writeCrateVersionForBuild('crate', '0.3.5');
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    // The manifest is read as utf8 text.
    expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), 'utf8');
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect((path as string).endsWith('Cargo.toml')).toBe(true);
    expect(contents).toContain('version = "0.3.5"');
  });

  it('is a no-op when the manifest already carries the planned version', async () => {
    readFileMock.mockResolvedValue(['[package]', 'name = "dirsql"', 'version = "0.3.5"', ''].join('\n'));
    const written = await writeCrateVersionForBuild('crate', '0.3.5');
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    // Same-version writes are skipped — nothing is persisted.
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('throws when Cargo.toml is missing', async () => {
    readFileMock.mockImplementation(ENOENT);
    await expect(writeCrateVersionForBuild('crate', '0.3.5')).rejects.toThrow(/Cargo\.toml not found/);
  });

  it('surfaces a non-ENOENT read failure unmodified', async () => {
    // A non-ENOENT read error (e.g. EISDIR when Cargo.toml is a directory)
    // must propagate rather than be remapped to the "not found" message.
    readFileMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('EISDIR: illegal operation on a directory'), { code: 'EISDIR' })),
    );
    await expect(writeCrateVersionForBuild('crate', '0.3.5')).rejects.toThrow();
    await expect(writeCrateVersionForBuild('crate', '0.3.5')).rejects.not.toThrow(/not found/);
  });

  it('throws when the manifest has no [package].version field', async () => {
    readFileMock.mockResolvedValue(['[package]', 'name = "dirsql"', 'edition = "2021"', ''].join('\n'));
    await expect(writeCrateVersionForBuild('crate', '0.3.5')).rejects.toThrow(/no \[package\]\.version/);
  });

  // #428: a binding crate in a cargo workspace (the napi / pyo3 polyglot
  // shape) sources its version from `[workspace.package].version` via
  // `version.workspace = true` and carries no literal `[package].version`.
  // The pre-build bump must rewrite the workspace root's
  // `[workspace.package].version` rather than throw.
  it('rewrites [workspace.package].version when the crate inherits it (version.workspace = true)', async () => {
    const memberCargo = ['[package]', 'name = "template-lib-node"', 'version.workspace = true', ''].join(
      '\n',
    );
    const rootCargo = [
      '[workspace]',
      'members = ["packages/node"]',
      'resolver = "2"',
      '',
      '[workspace.package]',
      'version = "0.2.7"',
      '',
    ].join('\n');
    // `wsroot` is a single path segment (no separator), so matching on it is
    // cross-platform safe; the member read is anything not the root.
    findRootMock.mockResolvedValue('wsroot');
    readFileMock.mockImplementation((p) =>
      Promise.resolve((p as string).includes('wsroot') ? rootCargo : memberCargo),
    );

    const written = await writeCrateVersionForBuild('crate', '0.3.5');

    expect(findRootMock).toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    // The workspace root is the manifest that actually changes, to the new
    // version — the member (with `version.workspace = true`) is never written.
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect((path as string).includes('wsroot')).toBe(true);
    expect(contents).toContain('version = "0.3.5"');
    expect(contents).not.toContain('version.workspace = true');
  });
});
