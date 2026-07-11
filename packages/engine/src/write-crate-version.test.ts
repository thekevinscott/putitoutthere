import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeCrateVersionForBuild } from './write-crate-version.js';

describe('writeCrateVersionForBuild (#366)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'write-crate-version-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites [package].version to the planned version', () => {
    writeFileSync(
      join(dir, 'Cargo.toml'),
      ['[package]', 'name = "dirsql"', 'version = "0.2.7"', 'edition = "2021"', ''].join('\n'),
      'utf8',
    );
    const written = writeCrateVersionForBuild(dir, '0.3.5');
    expect(written).toEqual([join(dir, 'Cargo.toml')]);
    expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toContain('version = "0.3.5"');
  });

  it('is a no-op when the manifest already carries the planned version', () => {
    const cargo = ['[package]', 'name = "dirsql"', 'version = "0.3.5"', ''].join('\n');
    writeFileSync(join(dir, 'Cargo.toml'), cargo, 'utf8');
    const written = writeCrateVersionForBuild(dir, '0.3.5');
    expect(written).toEqual([join(dir, 'Cargo.toml')]);
    // Unchanged on disk — same-version writes are skipped.
    expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toBe(cargo);
  });

  it('throws when Cargo.toml is missing', () => {
    expect(() => writeCrateVersionForBuild(dir, '0.3.5')).toThrow(/Cargo\.toml not found/);
  });

  it('surfaces a non-ENOENT read failure unmodified', () => {
    // `Cargo.toml` exists but is a directory — `readFileSync` fails
    // with a non-ENOENT error code (EISDIR), which must propagate
    // rather than be remapped to the "not found" message.
    mkdirSync(join(dir, 'Cargo.toml'));
    expect(() => writeCrateVersionForBuild(dir, '0.3.5')).toThrow();
    expect(() => writeCrateVersionForBuild(dir, '0.3.5')).not.toThrow(/not found/);
  });

  it('throws when the manifest has no [package].version field', () => {
    writeFileSync(
      join(dir, 'Cargo.toml'),
      ['[package]', 'name = "dirsql"', 'edition = "2021"', ''].join('\n'),
      'utf8',
    );
    expect(() => writeCrateVersionForBuild(dir, '0.3.5')).toThrow(/no \[package\]\.version/);
  });

  // #428: a binding crate in a cargo workspace (the napi / pyo3 polyglot
  // shape) sources its version from `[workspace.package].version` via
  // `version.workspace = true` and carries no literal `[package].version`.
  // The pre-build bump must rewrite the workspace root's
  // `[workspace.package].version` rather than throw.
  it('rewrites [workspace.package].version when the crate inherits it (version.workspace = true)', () => {
    const crateDir = join(dir, 'packages', 'node');
    mkdirSync(crateDir, { recursive: true });
    writeFileSync(
      join(dir, 'Cargo.toml'),
      [
        '[workspace]',
        'members = ["packages/node"]',
        'resolver = "2"',
        '',
        '[workspace.package]',
        'version = "0.2.7"',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(crateDir, 'Cargo.toml'),
      ['[package]', 'name = "template-lib-node"', 'version.workspace = true', ''].join('\n'),
      'utf8',
    );
    const written = writeCrateVersionForBuild(crateDir, '0.3.5');
    const rootCargo = join(dir, 'Cargo.toml');
    expect(written).toContain(rootCargo);
    expect(readFileSync(rootCargo, 'utf8')).toContain('version = "0.3.5"');
    // Member manifest keeps inheriting — no literal version injected.
    expect(readFileSync(join(crateDir, 'Cargo.toml'), 'utf8')).toContain('version.workspace = true');
  });
});
