/**
 * Cascade algorithm tests. Two-pass fixed point: direct glob match
 * (pass 1) plus transitive depends_on (pass 2 to stability).
 *
 * Plan: §11.
 * Issue #7.
 */

import { describe, expect, it } from 'vitest';
import { computeCascade, assertNoCycles } from './cascade.js';
import type { Package } from './config.js';

/**
 * Build a minimal Package suitable for cascade tests. Only the fields
 * cascade actually reads matter (name, paths, depends_on); the rest
 * are shaped to satisfy the discriminated union.
 */
function pkg(
  name: string,
  paths: string[],
  depends_on: string[] = [],
): Package {
  return {
    name,
    kind: 'crates',
    path: name,
    paths,
    depends_on,
    first_version: '0.1.0',
  } as Package;
}

describe('computeCascade: pass 1 (direct glob)', () => {
  it('returns empty when no paths match', () => {
    const cascade = computeCascade([pkg('a', ['a/**'])], ['b/x.ts']);
    expect(cascade).toEqual([]);
  });

  it('returns a package whose paths match', () => {
    const cascade = computeCascade([pkg('a', ['a/**'])], ['a/file.ts']);
    expect(cascade.map((p) => p.name)).toEqual(['a']);
  });

  it('returns multiple packages when their paths each match', () => {
    const cascade = computeCascade(
      [pkg('a', ['a/**']), pkg('b', ['b/**']), pkg('c', ['c/**'])],
      ['a/x', 'b/y'],
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });

  it('matches once even if multiple globs fire', () => {
    const cascade = computeCascade(
      [pkg('a', ['a/**/*.ts', 'a/**/*.rs'])],
      ['a/src/x.ts', 'a/src/y.rs'],
    );
    expect(cascade.map((p) => p.name)).toEqual(['a']);
  });
});

describe('computeCascade: pass 2 (transitive depends_on)', () => {
  it('promotes a downstream package when its dep cascaded', () => {
    const cascade = computeCascade(
      [
        pkg('rust', ['packages/rust/**']),
        pkg('python', ['packages/python/**'], ['rust']),
      ],
      ['packages/rust/src/lib.rs'],
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['python', 'rust']);
  });

  it('does not promote a downstream whose dep did not cascade', () => {
    const cascade = computeCascade(
      [
        pkg('rust', ['packages/rust/**']),
        pkg('python', ['packages/python/**'], ['rust']),
      ],
      ['packages/python/foo.py'],
    );
    expect(cascade.map((p) => p.name)).toEqual(['python']);
  });

  it('resolves a transitive chain: a → b → c', () => {
    const cascade = computeCascade(
      [
        pkg('a', ['a/**']),
        pkg('b', ['b/**'], ['a']),
        pkg('c', ['c/**'], ['b']),
      ],
      ['a/x'],
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('resolves a diamond: d depends on b and c; b and c both depend on a', () => {
    const cascade = computeCascade(
      [
        pkg('a', ['a/**']),
        pkg('b', ['b/**'], ['a']),
        pkg('c', ['c/**'], ['a']),
        pkg('d', ['d/**'], ['b', 'c']),
      ],
      ['a/x'],
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not include unrelated packages even when one dep in the list matched', () => {
    // `d` depends on `b` and `c`; only `b` cascaded, but d still goes
    // because ANY listed dep is enough.
    const cascade = computeCascade(
      [
        pkg('a', ['a/**']),
        pkg('b', ['b/**']),
        pkg('c', ['c/**']),
        pkg('d', ['d/**'], ['b', 'c']),
      ],
      ['b/x'],
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['b', 'd']);
  });
});

describe('computeCascade: edge cases', () => {
  it('empty package list returns empty cascade', () => {
    expect(computeCascade([], ['a/b'])).toEqual([]);
  });

  it('empty changed-files list returns empty cascade', () => {
    expect(computeCascade([pkg('a', ['a/**'])], [])).toEqual([]);
  });

  it('preserves input order in output', () => {
    const cascade = computeCascade(
      [pkg('a', ['a/**']), pkg('b', ['b/**']), pkg('c', ['c/**'])],
      ['c/x', 'a/y', 'b/z'],
    );
    expect(cascade.map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });

  it('a package with no `paths` but a matching depends_on still cascades', () => {
    const cascade = computeCascade(
      [
        pkg('a', ['a/**']),
        pkg('b', ['nothing/**'], ['a']),
      ],
      ['a/x'],
    );
    expect(cascade.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});

describe('computeCascade: depends_on validation', () => {
  it('throws on a self-loop', () => {
    expect(() =>
      computeCascade([pkg('a', ['a/**'], ['a'])], ['a/x']),
    ).toThrow(/cycle|a/i);
  });

  it('throws on a two-node cycle', () => {
    expect(() =>
      computeCascade(
        [pkg('a', ['a/**'], ['b']), pkg('b', ['b/**'], ['a'])],
        ['a/x'],
      ),
    ).toThrow(/cycle/i);
  });

  it('throws on a deeper cycle', () => {
    expect(() =>
      computeCascade(
        [
          pkg('a', ['a/**'], ['b']),
          pkg('b', ['b/**'], ['c']),
          pkg('c', ['c/**'], ['a']),
        ],
        ['a/x'],
      ),
    ).toThrow(/cycle/i);
  });

  it('throws on a dangling depends_on name', () => {
    expect(() =>
      computeCascade([pkg('a', ['a/**'], ['does-not-exist'])], ['a/x']),
    ).toThrow(/does-not-exist|unknown/i);
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
