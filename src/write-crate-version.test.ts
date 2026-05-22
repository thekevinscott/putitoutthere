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
});
