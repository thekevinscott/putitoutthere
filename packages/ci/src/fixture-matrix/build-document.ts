/**
 * Builds the fixture-matrix gate's JSON document from a real `plan()`
 * result (#670). `has_pypi` mirrors the grep-for-`"kind":"pypi"` step in
 * `e2e-fixture-job.yml`'s `plan` job, computed here from the same rows
 * instead of re-parsing the emitted JSON. Pure.
 */

import type { MatrixRow } from 'putitoutthere';

export interface FixtureMatrixDocument {
  fixture: string;
  matrix: readonly MatrixRow[];
  has_pypi: boolean;
}

export function buildFixtureMatrixDocument(
  fixture: string,
  matrix: readonly MatrixRow[],
): FixtureMatrixDocument {
  return {
    fixture,
    matrix,
    has_pypi: matrix.some((row) => row.kind === 'pypi'),
  };
}
