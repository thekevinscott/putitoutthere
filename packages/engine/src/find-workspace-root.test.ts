import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';

describe('findWorkspaceRoot (#428)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'find-workspace-root-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the ancestor whose Cargo.toml declares [workspace]', () => {
    const member = join(dir, 'packages', 'x');
    mkdirSync(member, { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), ['[workspace]', 'members = ["packages/x"]', ''].join('\n'), 'utf8');
    writeFileSync(
      join(member, 'Cargo.toml'),
      ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n'),
      'utf8',
    );
    expect(findWorkspaceRoot(member)).toBe(dir);
  });

  it('returns null when no ancestor declares [workspace]', () => {
    // Empty dir: its own Cargo.toml is absent (ENOENT skip), and nothing up
    // to the filesystem root declares a workspace — the walk bottoms out.
    expect(findWorkspaceRoot(dir)).toBeNull();
  });

  it('skips a malformed ancestor Cargo.toml and keeps walking', () => {
    const mid = join(dir, 'mid');
    mkdirSync(mid, { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), ['[workspace]', 'members = ["mid"]', ''].join('\n'), 'utf8');
    writeFileSync(join(mid, 'Cargo.toml'), '[unclosed\n', 'utf8'); // parse throws -> skipped
    expect(findWorkspaceRoot(mid)).toBe(dir);
  });

  it('propagates a non-ENOENT read error (Cargo.toml is a directory)', () => {
    mkdirSync(join(dir, 'Cargo.toml')); // reading a directory throws EISDIR, not ENOENT
    expect(() => findWorkspaceRoot(dir)).toThrow();
  });
});
