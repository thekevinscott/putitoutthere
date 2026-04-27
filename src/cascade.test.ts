/**
 * Cascade algorithm tests. Two-pass fixed point: direct glob match
 * (pass 1) plus transitive depends_on (pass 2 to stability).
 *
 * Plan: §11.
 * Issue #7.
 */

import { describe, expect, it } from 'vitest';
import { computeCascade, assertNoCycles, type ChangedFilesByPackage } from './cascade.js';
import type { Package } from './config.js';

/**
 * Build a per-package changed-files map where every listed package
 * sees the same `files` set. Mirrors the pre-#126 union-of-diffs shape
 * for tests that exercise cascade logic independent of tag history.
 */
function everyPkgSees(packages: readonly Package[], files: readonly string[]): ChangedFilesByPackage {
  const m = new Map<string, ReadonlySet<string>>();
  const set = new Set(files);
  for (const p of packages) m.set(p.name, set);
  return m;
}

/**
 * Build a per-package changed-files map from an explicit
 * `pkgName → files` mapping. Unlisted packages get no entry (i.e.
 * appear as if their last tag is at HEAD with no diff).
 */
function perPkg(entries: Record<string, readonly string[]>): ChangedFilesByPackage {
  const m = new Map<string, ReadonlySet<string>>();
  for (const [name, files] of Object.entries(entries)) {
    m.set(name, new Set(files));
  }
  return m;
}

/**
 * Build a minimal Package suitable for cascade tests. Only the fields
 * cascade actually reads matter (name, globs, depends_on); the rest
 * are shaped to satisfy the discriminated union.
 */
function pkg(
  name: string,
  globs: string[],
  depends_on: string[] = [],
): Package {
  return {
    name,
    kind: 'crates',
    path: name,
    globs,
    depends_on,
    first_version: '0.1.0',
  } as Package;
}

describe('computeCascade: pass 1 (direct glob)', () => {
  it('returns empty when no globs match', () => {
    const pkgs = [pkg('a', ['a/**'])];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['b/x.ts']));
    expect(cascade).toEqual([]);
  });

  it('returns a package whose globs match', () => {
    const pkgs = [pkg('a', ['a/**'])];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['a/file.ts']));
    expect(cascade.map((p) => p.name)).toEqual(['a']);
  });

  it('returns multiple packages when their globs each match', () => {
    const pkgs = [pkg('a', ['a/**']), pkg('b', ['b/**']), pkg('c', ['c/**'])];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['a/x', 'b/y']));
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });

  it('matches once even if multiple globs fire', () => {
    const pkgs = [pkg('a', ['a/**/*.ts', 'a/**/*.rs'])];
    const cascade = computeCascade(
      pkgs,
      everyPkgSees(pkgs, ['a/src/x.ts', 'a/src/y.rs']),
    );
    expect(cascade.map((p) => p.name)).toEqual(['a']);
  });

  it('uses per-package diffs, not a union (#126)', () => {
    // A was tagged at commit 100, B at commit 200. At HEAD=250, the
    // union would contain files changed between 100..200 (already
    // shipped under a prior B tag). Per-package isolation means B's
    // own diff (200..HEAD) is empty, so B does NOT cascade even
    // though A's diff contains files matching B's globs.
    const pkgs = [pkg('a', ['a/**']), pkg('b', ['b/**'])];
    const cascade = computeCascade(
      pkgs,
      perPkg({
        a: ['a/src.rs', 'b/legacy.ts'],
        b: [],
      }),
    );
    expect(cascade.map((p) => p.name)).toEqual(['a']);
  });

  it('packages with no map entry are skipped (no tag → no seed)', () => {
    const pkgs = [pkg('a', ['a/**']), pkg('b', ['b/**'])];
    const cascade = computeCascade(pkgs, perPkg({ a: ['a/x'] }));
    expect(cascade.map((p) => p.name)).toEqual(['a']);
  });
});

describe('computeCascade: pass 2 (transitive depends_on)', () => {
  it('promotes a downstream package when its dep cascaded', () => {
    const pkgs = [
      pkg('rust', ['packages/rust/**']),
      pkg('python', ['packages/python/**'], ['rust']),
    ];
    const cascade = computeCascade(
      pkgs,
      everyPkgSees(pkgs, ['packages/rust/src/lib.rs']),
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['python', 'rust']);
  });

  it('does not promote a downstream whose dep did not cascade', () => {
    const pkgs = [
      pkg('rust', ['packages/rust/**']),
      pkg('python', ['packages/python/**'], ['rust']),
    ];
    const cascade = computeCascade(
      pkgs,
      everyPkgSees(pkgs, ['packages/python/foo.py']),
    );
    expect(cascade.map((p) => p.name)).toEqual(['python']);
  });

  it('resolves a transitive chain: a → b → c', () => {
    const pkgs = [
      pkg('a', ['a/**']),
      pkg('b', ['b/**'], ['a']),
      pkg('c', ['c/**'], ['b']),
    ];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']));
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('resolves a diamond: d depends on b and c; b and c both depend on a', () => {
    const pkgs = [
      pkg('a', ['a/**']),
      pkg('b', ['b/**'], ['a']),
      pkg('c', ['c/**'], ['a']),
      pkg('d', ['d/**'], ['b', 'c']),
    ];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']));
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not include unrelated packages even when one dep in the list matched', () => {
    // `d` depends on `b` and `c`; only `b` cascaded, but d still goes
    // because ANY listed dep is enough.
    const pkgs = [
      pkg('a', ['a/**']),
      pkg('b', ['b/**']),
      pkg('c', ['c/**']),
      pkg('d', ['d/**'], ['b', 'c']),
    ];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['b/x']));
    expect(cascade.map((p) => p.name).sort()).toEqual(['b', 'd']);
  });
});

describe('computeCascade: edge cases', () => {
  it('empty package list returns empty cascade', () => {
    expect(computeCascade([], everyPkgSees([], ['a/b']))).toEqual([]);
  });

  it('empty changed-files list returns empty cascade', () => {
    const pkgs = [pkg('a', ['a/**'])];
    expect(computeCascade(pkgs, everyPkgSees(pkgs, []))).toEqual([]);
  });

  it('preserves input order in output', () => {
    const pkgs = [pkg('a', ['a/**']), pkg('b', ['b/**']), pkg('c', ['c/**'])];
    const cascade = computeCascade(
      pkgs,
      everyPkgSees(pkgs, ['c/x', 'a/y', 'b/z']),
    );
    expect(cascade.map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });

  it('a package with no `globs` but a matching depends_on still cascades', () => {
    const pkgs = [
      pkg('a', ['a/**']),
      pkg('b', ['nothing/**'], ['a']),
    ];
    const cascade = computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']));
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});

describe('computeCascade: depends_on validation', () => {
  it('throws on a self-loop', () => {
    const pkgs = [pkg('a', ['a/**'], ['a'])];
    expect(() => computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']))).toThrow(/cycle|a/i);
  });

  it('throws on a two-node cycle', () => {
    const pkgs = [pkg('a', ['a/**'], ['b']), pkg('b', ['b/**'], ['a'])];
    expect(() => computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']))).toThrow(/cycle/i);
  });

  it('throws on a deeper cycle', () => {
    const pkgs = [
      pkg('a', ['a/**'], ['b']),
      pkg('b', ['b/**'], ['c']),
      pkg('c', ['c/**'], ['a']),
    ];
    expect(() => computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']))).toThrow(/cycle/i);
  });

  it('throws on a dangling depends_on name', () => {
    const pkgs = [pkg('a', ['a/**'], ['does-not-exist'])];
    expect(() => computeCascade(pkgs, everyPkgSees(pkgs, ['a/x']))).toThrow(
      /does-not-exist|unknown/i,
    );
  });
});

describe('assertNoCycles', () => {
  it('accepts an acyclic graph', () => {
    expect(() =>
      assertNoCycles([
        pkg('a', ['a/**']),
        pkg('b', ['b/**'], ['a']),
        pkg('c', ['c/**'], ['a', 'b']),
      ]),
    ).not.toThrow();
  });

  it('accepts disconnected components', () => {
    expect(() =>
      assertNoCycles([
        pkg('a', ['a/**']),
        pkg('b', ['b/**']),
        pkg('c', ['c/**'], ['a']),
        pkg('d', ['d/**'], ['b']),
      ]),
    ).not.toThrow();
  });

  it('rejects a cycle', () => {
    expect(() =>
      assertNoCycles([
        pkg('a', ['a/**'], ['b']),
        pkg('b', ['b/**'], ['a']),
      ]),
    ).toThrow(/cycle/i);
  });
});
