/**
 * Unit tests for `cargoDepEntries` (#621).
 *
 * The contract that matters is coverage of the tables cargo resolves: a
 * stale version requirement in ANY of them fails resolution identically
 * (verified against cargo 1.94.1), so a table missed here becomes an
 * unbuildable tree at release time.
 */

import { describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';

import { cargoDepEntries } from './cargo-dep-entries.js';

const entriesOf = (toml: string): ReturnType<typeof cargoDepEntries> =>
  cargoDepEntries(parseToml(toml));

const keys = (toml: string): string[] => entriesOf(toml).map((e) => e.key).sort();

describe('cargoDepEntries', () => {
  it('collects entries from every dependency table cargo resolves', () => {
    expect(
      keys(
        [
          '[dependencies]',
          'a = { path = "../a" }',
          '[dev-dependencies]',
          'b = { path = "../b" }',
          '[build-dependencies]',
          'c = { path = "../c" }',
          "[target.'cfg(unix)'.dependencies]",
          'd = { path = "../d" }',
          '[workspace.dependencies]',
          'e = { path = "e" }',
        ].join('\n'),
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('collects target-specific dev and build tables too', () => {
    expect(
      keys(
        [
          "[target.'cfg(windows)'.dev-dependencies]",
          'a = { path = "../a" }',
          "[target.'cfg(windows)'.build-dependencies]",
          'b = { path = "../b" }',
        ].join('\n'),
      ),
    ).toEqual(['a', 'b']);
  });

  it('reports the path and version requirement of a path dependency', () => {
    const [entry] = entriesOf('[dependencies]\na = { path = "../a", version = "0.2" }\n');
    expect(entry).toEqual({
      key: 'a',
      path: '../a',
      hasVersionReq: true,
      inheritsFromWorkspace: false,
    });
  });

  it('marks a path dependency carrying no version requirement', () => {
    const [entry] = entriesOf('[dependencies]\na = { path = "../a" }\n');
    expect(entry?.hasVersionReq).toBe(false);
    expect(entry?.path).toBe('../a');
  });

  it('treats the shorthand form as a registry dependency with no path', () => {
    const [entry] = entriesOf('[dependencies]\nserde = "1"\n');
    // Never a path dependency, so it must never be rewritten -- but it does
    // carry a requirement, and reporting that keeps callers from re-deriving it.
    expect(entry).toEqual({ key: 'serde', hasVersionReq: true, inheritsFromWorkspace: false });
  });

  it('flags an entry that defers to [workspace.dependencies]', () => {
    const [entry] = entriesOf('[dependencies]\na.workspace = true\n');
    expect(entry?.inheritsFromWorkspace).toBe(true);
    expect(entry?.path).toBeUndefined();
    expect(entry?.hasVersionReq).toBe(false);
  });

  it('reports a registry dependency with no path', () => {
    const [entry] = entriesOf('[dependencies]\npyo3 = { version = "0.22" }\n');
    expect(entry?.path).toBeUndefined();
    expect(entry?.hasVersionReq).toBe(true);
  });

  it('returns nothing for a manifest with no dependencies', () => {
    expect(entriesOf('[package]\nname = "x"\nversion = "1.0.0"\n')).toEqual([]);
  });

  it('returns nothing for a non-object input', () => {
    expect(cargoDepEntries(null)).toEqual([]);
    expect(cargoDepEntries('not a manifest')).toEqual([]);
  });
});
