/**
 * Unit tests for `cargoDepEntries` (#621).
 *
 * The contract that matters is coverage of the tables cargo resolves: a
 * stale version requirement in ANY of them fails resolution identically
 * (verified against cargo 1.94.1), so a table missed here becomes an
 * unbuildable tree at release time.
 *
 * Fixtures are plain objects rather than parsed TOML. The unit under test
 * is the flattening, not the parser, so feeding it the parser's output
 * shape directly keeps the test isolated from `smol-toml` entirely.
 */

import { describe, expect, it } from 'vitest';

import { cargoDepEntries } from './cargo-dep-entries.js';

const keys = (parsed: unknown): string[] =>
  cargoDepEntries(parsed)
    .map((e) => e.key)
    .sort();

describe('cargoDepEntries', () => {
  it('collects entries from every dependency table cargo resolves', () => {
    expect(
      keys({
        dependencies: { a: { path: '../a' } },
        'dev-dependencies': { b: { path: '../b' } },
        'build-dependencies': { c: { path: '../c' } },
        target: { 'cfg(unix)': { dependencies: { d: { path: '../d' } } } },
        workspace: { dependencies: { e: { path: 'e' } } },
      }),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('collects target-specific dev and build tables too', () => {
    expect(
      keys({
        target: {
          'cfg(windows)': {
            'dev-dependencies': { a: { path: '../a' } },
            'build-dependencies': { b: { path: '../b' } },
          },
        },
      }),
    ).toEqual(['a', 'b']);
  });

  it('reports the path and version requirement of a path dependency', () => {
    const [entry] = cargoDepEntries({ dependencies: { a: { path: '../a', version: '0.2' } } });
    expect(entry).toEqual({
      key: 'a',
      path: '../a',
      hasVersionReq: true,
      inheritsFromWorkspace: false,
    });
  });

  it('marks a path dependency carrying no version requirement', () => {
    const [entry] = cargoDepEntries({ dependencies: { a: { path: '../a' } } });
    expect(entry?.hasVersionReq).toBe(false);
    expect(entry?.path).toBe('../a');
  });

  it('treats the shorthand form as a registry dependency with no path', () => {
    const [entry] = cargoDepEntries({ dependencies: { serde: '1' } });
    // Never a path dependency, so it must never be rewritten -- but it does
    // carry a requirement, and reporting that keeps callers from re-deriving it.
    expect(entry).toEqual({ key: 'serde', hasVersionReq: true, inheritsFromWorkspace: false });
  });

  it('flags an entry that defers to [workspace.dependencies]', () => {
    const [entry] = cargoDepEntries({ dependencies: { a: { workspace: true } } });
    expect(entry?.inheritsFromWorkspace).toBe(true);
    expect(entry?.path).toBeUndefined();
    expect(entry?.hasVersionReq).toBe(false);
  });

  it('reports a registry dependency with no path', () => {
    const [entry] = cargoDepEntries({ dependencies: { pyo3: { version: '0.22' } } });
    expect(entry?.path).toBeUndefined();
    expect(entry?.hasVersionReq).toBe(true);
  });

  it('ignores a non-string path', () => {
    const [entry] = cargoDepEntries({ dependencies: { a: { path: 42 } } });
    expect(entry?.path).toBeUndefined();
  });

  it('treats a null dependency value as carrying nothing', () => {
    const [entry] = cargoDepEntries({ dependencies: { a: null } });
    expect(entry).toEqual({ key: 'a', hasVersionReq: false, inheritsFromWorkspace: false });
  });

  it('ignores dependency tables that are not objects', () => {
    expect(cargoDepEntries({ dependencies: 'nonsense', target: 'nonsense' })).toEqual([]);
  });

  it('ignores a target entry that is not an object', () => {
    expect(cargoDepEntries({ target: { 'cfg(unix)': 'nonsense' } })).toEqual([]);
  });

  // `typeof null === "object"`, so every table guard needs an explicit null
  // arm or the walk reaches a property read on null and throws. Each case
  // below is a distinct guard.
  it('ignores a null dependency table', () => {
    expect(cargoDepEntries({ dependencies: null })).toEqual([]);
  });

  it('ignores a null target table', () => {
    expect(cargoDepEntries({ target: null })).toEqual([]);
  });

  it('ignores a null entry under target', () => {
    expect(cargoDepEntries({ target: { 'cfg(unix)': null } })).toEqual([]);
  });

  it('ignores a null workspace table', () => {
    expect(cargoDepEntries({ workspace: null })).toEqual([]);
  });

  it('ignores a null workspace dependencies table', () => {
    expect(cargoDepEntries({ workspace: { dependencies: null } })).toEqual([]);
  });

  it('returns nothing for a manifest with no dependencies', () => {
    expect(cargoDepEntries({ package: { name: 'x', version: '1.0.0' } })).toEqual([]);
  });

  it('returns nothing for a non-object input', () => {
    expect(cargoDepEntries(null)).toEqual([]);
    expect(cargoDepEntries('not a manifest')).toEqual([]);
  });
});
