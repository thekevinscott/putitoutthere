/**
 * Pure builder for the fixture-matrix gate's JSON document (#670).
 * `has_pypi` must reflect the actual rows passed in, not a separate
 * re-derivation that could drift from them.
 */

import { describe, expect, it } from 'vitest';
import type { MatrixRow } from 'putitoutthere';

import { buildFixtureMatrixDocument } from './build-document.js';

function row(overrides: Partial<MatrixRow> & Pick<MatrixRow, 'kind'>): MatrixRow {
  return {
    name: 'pkg',
    version: '0.0.0',
    target: 'noarch',
    runs_on: 'ubuntu-latest',
    artifact_name: 'pkg-artifact',
    artifact_path: 'dist/pkg',
    path: '.',
    ...overrides,
  };
}

describe('buildFixtureMatrixDocument', () => {
  it('carries the fixture name and the matrix rows verbatim', () => {
    const matrix = [row({ kind: 'npm' })];
    expect(buildFixtureMatrixDocument('js-vanilla', matrix)).toEqual({
      fixture: 'js-vanilla',
      matrix,
      has_pypi: false,
    });
  });

  it('sets has_pypi when any row is a pypi row', () => {
    const matrix = [row({ kind: 'npm' }), row({ kind: 'pypi' })];
    expect(buildFixtureMatrixDocument('polyglot-everything-first-publish', matrix).has_pypi).toBe(true);
  });

  it('is false when no row is pypi', () => {
    const matrix = [row({ kind: 'crates' }), row({ kind: 'npm' })];
    expect(buildFixtureMatrixDocument('rust-vanilla-first-publish', matrix).has_pypi).toBe(false);
  });

  it('is false for an empty matrix', () => {
    expect(buildFixtureMatrixDocument('js-vanilla', []).has_pypi).toBe(false);
  });
});
