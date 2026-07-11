import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

describe('writeResolvedCargoVersion (#428)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'write-resolved-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the literal path when the manifest does not cleanly parse', () => {
    // Invalid TOML (an unclosed table trails a regex-matchable
    // [package].version): inheritance detection can't parse it, so the
    // rewrite takes the literal path via replaceCargoVersion.
    const src = ['[package]', 'version = "0.1.0"', '[bad'].join('\n');
    const written = writeResolvedCargoVersion(dir, src, '0.2.0');
    expect(written).toEqual([join(dir, 'Cargo.toml')]);
    expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toContain('version = "0.2.0"');
  });

  it('throws when an inheriting crate has no ancestor [workspace]', () => {
    const src = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');
    expect(() => writeResolvedCargoVersion(dir, src, '1.0.0')).toThrow(/no ancestor \[workspace\]/);
  });
});
