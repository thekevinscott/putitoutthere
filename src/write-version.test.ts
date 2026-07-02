import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeVersionForBuild } from './write-version.js';

describe('writeVersionForBuild (#276, #428)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'write-version-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

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

  it('rewrites the sibling [package].version for a single-crate maturin package', () => {
    writeFileSync(join(dir, 'pyproject.toml'), dynamicPyproject, 'utf8');
    writeFileSync(
      join(dir, 'Cargo.toml'),
      ['[package]', 'name = "template-lib"', 'version = "0.0.1"', 'edition = "2021"', ''].join('\n'),
      'utf8',
    );
    const written = writeVersionForBuild(dir, '1.2.3');
    expect(written).toEqual([join(dir, 'Cargo.toml')]);
    expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toContain('version = "1.2.3"');
  });

  // #428: the idiomatic polyglot layout — one Rust core plus Python / Node
  // bindings in a single cargo workspace — sources every member's version
  // from `[workspace.package].version` and has members inherit it via
  // `version.workspace = true`. The maturin member crate therefore carries
  // no literal `[package].version`, so the pre-build bump must rewrite the
  // workspace root's `[workspace.package].version` instead of throwing
  // `no [package].version field found`.
  it('rewrites [workspace.package].version when the maturin crate inherits it (version.workspace = true)', () => {
    const pkgDir = join(dir, 'packages', 'python');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(dir, 'Cargo.toml'),
      [
        '[workspace]',
        'members = ["packages/python"]',
        'resolver = "2"',
        '',
        '[workspace.package]',
        'version = "0.0.1"',
        'edition = "2021"',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(pkgDir, 'Cargo.toml'),
      [
        '[package]',
        'name = "template-lib-py"',
        'version.workspace = true',
        'edition.workspace = true',
        '',
        '[lib]',
        'crate-type = ["cdylib"]',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(pkgDir, 'pyproject.toml'), dynamicPyproject, 'utf8');

    const written = writeVersionForBuild(pkgDir, '1.2.3');

    // The workspace root is the manifest that actually changes.
    const rootCargo = join(dir, 'Cargo.toml');
    expect(written).toContain(rootCargo);
    expect(readFileSync(rootCargo, 'utf8')).toContain('version = "1.2.3"');
    // The member manifest keeps inheriting — no literal version injected.
    expect(readFileSync(join(pkgDir, 'Cargo.toml'), 'utf8')).toContain('version.workspace = true');
  });
});
