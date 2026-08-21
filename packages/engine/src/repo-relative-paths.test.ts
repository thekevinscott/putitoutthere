/**
 * Unit tests for `repoRelativePaths` / `toPosixPath` (#639).
 *
 * No `node:path` import: the unit suite isolates the unit under test, and
 * mocking `relative()` would leave nothing real to assert on. Every case is
 * therefore written with *relative* inputs, which `relative()` resolves
 * against the process cwd — so the same strings mean the same thing on
 * ubuntu, macos and windows, and the separator conversion is exercised on a
 * literal rather than on whatever the host happens to emit.
 */

import { describe, expect, it } from 'vitest';

import { repoRelativePaths, toPosixPath } from './repo-relative-paths.js';

describe('toPosixPath', () => {
  it('rewrites backslash separators to forward slashes', () => {
    // git speaks forward slashes on every platform; a Windows-shaped path
    // compared against porcelain output would never match.
    expect(toPosixPath('pkg\\rust\\Cargo.toml')).toBe('pkg/rust/Cargo.toml');
  });

  it('leaves an already-posix path alone', () => {
    expect(toPosixPath('pkg/rust/Cargo.toml')).toBe('pkg/rust/Cargo.toml');
  });
});

describe('repoRelativePaths', () => {
  it('renders a path under the root as repo-relative and forward-slashed', () => {
    expect(repoRelativePaths('.', ['pkg/Cargo.toml'])).toEqual(['pkg/Cargo.toml']);
  });

  it('keeps every path it is given, in the order given', () => {
    expect(repoRelativePaths('.', ['b/Cargo.toml', 'a/Cargo.toml'])).toEqual([
      'b/Cargo.toml',
      'a/Cargo.toml',
    ]);
  });

  it('returns nothing when given no paths at all', () => {
    // The callers hold an optional field; `undefined` has to mean "none"
    // rather than blowing up or inventing an entry.
    expect(repoRelativePaths('.', undefined)).toEqual([]);
  });

  it('returns nothing when given an empty list', () => {
    expect(repoRelativePaths('.', [])).toEqual([]);
  });

  it('drops the root itself', () => {
    // `relative(root, root)` is the empty string, which is not a path git
    // could ever name — admitting it would put a value in the comparison set
    // that matches nothing and reads like it might.
    expect(repoRelativePaths('.', ['.'])).toEqual([]);
  });

  it('drops a path that sits outside the root', () => {
    // porcelain never names a file outside the repository, so a `../…` entry
    // could only ever fail to match.
    expect(repoRelativePaths('pkg', ['other/Cargo.toml'])).toEqual([]);
  });

  it('keeps the paths under the root when an outside one is mixed in', () => {
    expect(repoRelativePaths('pkg', ['other/Cargo.toml', 'pkg/sub/Cargo.toml'])).toEqual([
      'sub/Cargo.toml',
    ]);
  });
});
