/**
 * Unit tests for `writeResolvedCargoVersion` (#428).
 *
 * `node:fs` and the workspace-root walk (`findWorkspaceRoot`, itself an fs
 * collaborator) are mocked so this isolates the inheritance-detection and
 * literal-vs-workspace routing; the pure `replaceCargoVersion` /
 * `replaceWorkspacePackageVersion` string rewriters run for real. Real
 * on-disk manifests are exercised by the integration + e2e tiers.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

vi.mock('node:fs/promises');
vi.mock('./find-workspace-root.js');

const writeMock = vi.mocked(writeFile);
const readMock = vi.mocked(readFile);
const findRootMock = vi.mocked(findWorkspaceRoot);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writeResolvedCargoVersion (#428)', () => {
  it('falls back to the literal path when the manifest does not cleanly parse', async () => {
    // Invalid TOML (an unclosed table trails a regex-matchable
    // [package].version): inheritance detection can't parse it, so the
    // rewrite takes the literal path via replaceCargoVersion.
    const src = ['[package]', 'version = "0.1.0"', '[bad'].join('\n');
    const written = await writeResolvedCargoVersion('crate', src, '0.2.0');
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    // No workspace walk on the literal path.
    expect(findRootMock).not.toHaveBeenCalled();
    // The literal rewrite is persisted with the new version.
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect((path as string).endsWith('Cargo.toml')).toBe(true);
    expect(contents).toContain('version = "0.2.0"');
    // The literal rewrite is persisted as utf8 text.
    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), expect.anything(), 'utf8');
  });

  it('throws when an inheriting crate has no ancestor [workspace]', async () => {
    findRootMock.mockResolvedValue(null);
    const src = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');
    await expect(writeResolvedCargoVersion('crate', src, '1.0.0')).rejects.toThrow(
      /no ancestor \[workspace\]/,
    );
  });

  it('returns the root path without writing when the workspace version already matches', async () => {
    // Idempotent inheriting-crate path: the root [workspace.package].version
    // already equals the target, so replaceWorkspacePackageVersion returns it
    // unchanged and no write is issued — but the root path is still reported.
    findRootMock.mockResolvedValue('/ws');
    readMock.mockResolvedValue(['[workspace.package]', 'version = "1.2.3"', ''].join('\n'));
    const src = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');
    const written = await writeResolvedCargoVersion('crate', src, '1.2.3');
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    expect(writeMock).not.toHaveBeenCalled();
    // The workspace-root manifest is read as utf8 text.
    expect(readMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), 'utf8');
  });

  it('rewrites the workspace-root [workspace.package].version and persists it as utf8', async () => {
    // Inheriting crate whose workspace root carries a *different* version, so
    // replaceWorkspacePackageVersion changes it and the root manifest is written.
    findRootMock.mockResolvedValue('/ws');
    readMock.mockResolvedValue(['[workspace.package]', 'version = "1.2.3"', ''].join('\n'));
    const src = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');
    const written = await writeResolvedCargoVersion('crate', src, '2.0.0');
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect((path as string).endsWith('Cargo.toml')).toBe(true);
    expect(contents).toContain('version = "2.0.0"');
    // The root rewrite is persisted as utf8 text.
    expect(writeMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), expect.anything(), 'utf8');
  });
});
