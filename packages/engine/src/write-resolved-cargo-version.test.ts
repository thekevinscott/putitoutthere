/**
 * Unit tests for `writeResolvedCargoVersion` (#428).
 *
 * `node:fs` and the workspace-root walk (`findWorkspaceRoot`, itself an fs
 * collaborator) are mocked so this isolates the inheritance-detection and
 * literal-vs-workspace routing; the pure `replaceCargoVersion` /
 * `replaceWorkspacePackageVersion` string rewriters run for real. Real
 * on-disk manifests are exercised by the integration + e2e tiers.
 */

import { writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

vi.mock('node:fs');
vi.mock('./find-workspace-root.js');

const writeMock = vi.mocked(writeFileSync);
const findRootMock = vi.mocked(findWorkspaceRoot);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writeResolvedCargoVersion (#428)', () => {
  it('falls back to the literal path when the manifest does not cleanly parse', () => {
    // Invalid TOML (an unclosed table trails a regex-matchable
    // [package].version): inheritance detection can't parse it, so the
    // rewrite takes the literal path via replaceCargoVersion.
    const src = ['[package]', 'version = "0.1.0"', '[bad'].join('\n');
    const written = writeResolvedCargoVersion('crate', src, '0.2.0');
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    // No workspace walk on the literal path.
    expect(findRootMock).not.toHaveBeenCalled();
    // The literal rewrite is persisted with the new version.
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect(String(path).endsWith('Cargo.toml')).toBe(true);
    expect(contents).toContain('version = "0.2.0"');
  });

  it('throws when an inheriting crate has no ancestor [workspace]', () => {
    findRootMock.mockReturnValue(null);
    const src = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');
    expect(() => writeResolvedCargoVersion('crate', src, '1.0.0')).toThrow(
      /no ancestor \[workspace\]/,
    );
  });
});
