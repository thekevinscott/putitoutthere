/**
 * Builds the willfire-callback wire envelope (#681) from the fixture-matrix
 * gate's already-computed matrix rows: `matrix` re-encodes the row array as
 * the exact JSON string the live plan job would write to $GITHUB_OUTPUT
 * (see packages/engine/src/emit-plan-outputs.ts), and `has_pypi` restates
 * the boolean as the all-string form willfire's protocol requires. Pure.
 */

export interface WillfireCallbackOutput {
  matrix: string;
  has_pypi: string;
}

export function buildWillfireCallbackOutput(matrix: readonly unknown[], hasPypi: boolean): WillfireCallbackOutput {
  return {
    matrix: JSON.stringify(matrix),
    has_pypi: hasPypi ? 'true' : 'false',
  };
}
