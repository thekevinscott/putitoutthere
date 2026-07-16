/**
 * Unit tests for `writeVersionForBuild` (#276, #428).
 *
 * `node:fs` and the workspace-root walk (`findWorkspaceRoot`, itself an fs
 * collaborator) are mocked so each case isolates the pyproject-gate + cargo
 * routing; the pure `replaceCargoVersion` / `replaceWorkspacePackageVersion`
 * string rewriters (via `writeResolvedCargoVersion`) run for real. Real
 * on-disk manifest round-trips are covered by the integration + e2e tiers.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';
import { writeVersionForBuild } from './write-version.js';

vi.mock('node:fs');
vi.mock('./find-workspace-root.js');

const readFileMock = vi.mocked(readFileSync);
const writeMock = vi.mocked(writeFileSync);
const findRootMock = vi.mocked(findWorkspaceRoot);

const dynamicPyproject = [
  '[project]',
  'name = "template-lib"',
  'dynamic = ["version"]',
  '',
  '[build-system]',
  'requires = ["maturin>=1.0,<2.0"]',
  'build-backend = "maturin"',
  '',
].join('\n');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writeVersionForBuild (#276, #428)', () => {
  it('rewrites the sibling [package].version for a single-crate maturin package', () => {
    const cargo = [
      '[package]',
      'name = "template-lib"',
      'version = "0.0.1"',
      'edition = "2021"',
      '',
    ].join('\n');
    readFileMock.mockImplementation((p) =>
      String(p).endsWith('pyproject.toml') ? dynamicPyproject : cargo,
    );

    const written = writeVersionForBuild('pkg', '1.2.3');

    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith('Cargo.toml')).toBe(true);
    // No workspace walk on the literal path.
    expect(findRootMock).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect(String(path).endsWith('Cargo.toml')).toBe(true);
    expect(contents).toContain('version = "1.2.3"');
  });

  // #428: the idiomatic polyglot layout — one Rust core plus Python / Node
  // bindings in a single cargo workspace — sources every member's version
  // from `[workspace.package].version` and has members inherit it via
  // `version.workspace = true`. The maturin member crate therefore carries
  // no literal `[package].version`, so the pre-build bump must rewrite the
  // workspace root's `[workspace.package].version` instead of throwing
  // `no [package].version field found`.
  it('rewrites [workspace.package].version when the maturin crate inherits it (version.workspace = true)', () => {
    const memberCargo = [
      '[package]',
      'name = "template-lib-py"',
      'version.workspace = true',
      'edition.workspace = true',
      '',
      '[lib]',
      'crate-type = ["cdylib"]',
      '',
    ].join('\n');
    const rootCargo = [
      '[workspace]',
      'members = ["packages/python"]',
      'resolver = "2"',
      '',
      '[workspace.package]',
      'version = "0.0.1"',
      'edition = "2021"',
      '',
    ].join('\n');
    // `wsroot` is a single path segment (no separator), so matching on it is
    // cross-platform safe; the member read is anything not the root.
    findRootMock.mockReturnValue('wsroot');
    readFileMock.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith('pyproject.toml')) {return dynamicPyproject;}
      return path.includes('wsroot') ? rootCargo : memberCargo;
    });

    const written = writeVersionForBuild('pkg', '1.2.3');

    expect(findRootMock).toHaveBeenCalled();
    expect(written).toHaveLength(1);
    // The workspace root is the manifest that actually changes; the member
    // manifest keeps inheriting — no literal version is injected into it.
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [path, contents] = writeMock.mock.calls[0]!;
    expect(String(path).includes('wsroot')).toBe(true);
    expect(contents).toContain('version = "1.2.3"');
    expect(contents).not.toContain('version.workspace = true');
  });

  // Error contract (#276, #333): each malformed input surfaces an actionable
  // message instead of building an under-versioned artifact. `node:fs` is
  // already mocked, so the throw branches are driven purely by mocked reads.
  const enoent = () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return err;
  };

  it('throws when pyproject.toml is missing', () => {
    readFileMock.mockImplementation(() => {
      throw enoent();
    });
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow('pyproject.toml not found');
  });

  it('throws when pyproject.toml is malformed', () => {
    readFileMock.mockImplementation((p) =>
      String(p).endsWith('pyproject.toml') ? 'not valid = = toml ][' : '',
    );
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow('failed to parse');
  });

  it('throws when pyproject.toml has no [project] table', () => {
    readFileMock.mockImplementation((p) =>
      String(p).endsWith('pyproject.toml') ? '[build-system]\nrequires = []\n' : '',
    );
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow('has no [project] table');
  });

  it('throws on a static [project].version literal (#333)', () => {
    readFileMock.mockImplementation((p) =>
      String(p).endsWith('pyproject.toml')
        ? '[project]\nname = "lib"\nversion = "1.0.0"\n'
        : '',
    );
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow('declares a static');
  });

  it('throws when [project] declares no version source', () => {
    readFileMock.mockImplementation((p) =>
      String(p).endsWith('pyproject.toml') ? '[project]\nname = "lib"\n' : '',
    );
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow('declares no version source');
  });

  it('throws when Cargo.toml is missing under a dynamic pyproject', () => {
    readFileMock.mockImplementation((p) => {
      if (String(p).endsWith('pyproject.toml')) {return dynamicPyproject;}
      throw enoent();
    });
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow('Cargo.toml is missing');
  });

  // A non-ENOENT read error (e.g. EACCES) is not the "missing file" case, so
  // it must surface as-is rather than be re-wrapped as a not-found message.
  const eacces = () => {
    const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    return err;
  };

  it('rethrows a non-ENOENT error from the pyproject read as-is', () => {
    readFileMock.mockImplementation((p) => {
      if (String(p).endsWith('pyproject.toml')) {throw eacces();}
      return '';
    });
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow(/EACCES/);
    expect(() => writeVersionForBuild('pkg', '1.2.3')).not.toThrow(/not found/);
  });

  it('rethrows a non-ENOENT error from the Cargo.toml read as-is', () => {
    readFileMock.mockImplementation((p) => {
      if (String(p).endsWith('pyproject.toml')) {return dynamicPyproject;}
      throw eacces();
    });
    expect(() => writeVersionForBuild('pkg', '1.2.3')).toThrow(/EACCES/);
    expect(() => writeVersionForBuild('pkg', '1.2.3')).not.toThrow(/is missing/);
  });
});
