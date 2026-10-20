/**
 * Glob matcher tests. Covers every row in plan.md §11.4.
 *
 * Issue #10.
 */

import { describe, expect, it } from 'vitest';
import { matchesGlob, matchesAny } from './glob.js';

describe('matchesGlob (§11.4 table)', () => {
  it.each([
    ['packages/python/**/*.py', 'packages/python/foo.py', true],
    ['packages/python/**/*.py', 'packages/python/sub/foo.py', true],
    ['packages/python/**/*.py', 'packages/python/foo.rs', false],
    ['packages/python/**/*.py', 'packages/rust/foo.py', false],

    ['packages/python/**', 'packages/python/foo.py', true],
    ['packages/python/**', 'packages/python/sub/deep/file.txt', true],
    ['packages/python/**', 'packages/rust/foo.py', false],

    ['packages/{python,rust}/**', 'packages/python/a.py', true],
    ['packages/{python,rust}/**', 'packages/rust/a.rs', true],
    ['packages/{python,rust}/**', 'packages/docs/index.md', false],

    ['Cargo.lock', 'Cargo.lock', true],
    ['Cargo.lock', 'packages/rust/Cargo.lock', false],
    // Leading `**/` is NOT implicit (matchBase: false). Users must write
    // it explicitly to cascade on nested files. Docs: guide/cascade.md.
    ['**/Cargo.lock', 'Cargo.lock', true],
    ['**/Cargo.lock', 'packages/rust/Cargo.lock', true],
  ])('glob %s against path %s → %s', (pattern, path, expected) => {
    expect(matchesGlob(pattern, path)).toBe(expected);
  });
});

describe('matchesGlob: dotfiles', () => {
  it('matches hidden files (dot: true)', () => {
    // `.github/workflows/foo.yml` vs `**/*.yml` — minimatch's default
    // would skip dot-prefixed dirs; we enable `dot: true` because real
    // repos keep release configs under `.github/`.
    expect(matchesGlob('**/*.yml', '.github/workflows/release.yml')).toBe(true);
  });
});

describe('matchesAny', () => {
  it('returns true when any pattern matches', () => {
    expect(matchesAny(['a/**', 'b/**'], 'b/x.ts')).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    expect(matchesAny(['a/**', 'b/**'], 'c/x.ts')).toBe(false);
  });

  it('returns false for an empty pattern list', () => {
    expect(matchesAny([], 'a.ts')).toBe(false);
  });
});
