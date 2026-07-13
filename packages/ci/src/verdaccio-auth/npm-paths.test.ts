/**
 * Pins that `parseNpmPaths` reproduces `jq -r '.[] | select(.kind == "npm") |
 * .path' | sort -u`: npm rows only, de-duplicated, sorted. Pure. Assertions are
 * exact (`toEqual` on the whole list).
 */

import { describe, expect, it } from 'vitest';

import { parseNpmPaths } from './npm-paths.js';

describe('parseNpmPaths', () => {
  it('keeps only npm rows and returns their paths', () => {
    const matrix = JSON.stringify([
      { kind: 'npm', path: 'packages/js' },
      { kind: 'crates', path: 'crates/core' },
      { kind: 'pypi', path: 'py' },
    ]);
    expect(parseNpmPaths(matrix)).toEqual(['packages/js']);
  });

  it('de-duplicates repeated paths (per-triple rows share one package dir)', () => {
    const matrix = JSON.stringify([
      { kind: 'npm', path: 'pkg', target: 'main' },
      { kind: 'npm', path: 'pkg', target: 'x64' },
    ]);
    expect(parseNpmPaths(matrix)).toEqual(['pkg']);
  });

  it('sorts the paths lexicographically', () => {
    const matrix = JSON.stringify([
      { kind: 'npm', path: 'zeta' },
      { kind: 'npm', path: 'alpha' },
      { kind: 'npm', path: 'mid' },
    ]);
    expect(parseNpmPaths(matrix)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('returns an empty list when no npm rows are present', () => {
    expect(parseNpmPaths(JSON.stringify([{ kind: 'crates', path: 'c' }]))).toEqual([]);
  });

  it('yields the literal "null" for an npm row missing a path (jq -r prints null)', () => {
    expect(parseNpmPaths(JSON.stringify([{ kind: 'npm' }]))).toEqual(['null']);
  });
});
