import type { FixtureDocument } from './parse-fixture-document.js';

export interface CallbackEntry {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

// Output values are the exact strings `$GITHUB_OUTPUT` would carry:
// `emitPlanOutputs` writes `matrix=${JSON.stringify(matrix)}`, so the
// matrix rides JSON-double-encoded; `has_pypi` is the step's 'true'/'false'.
export function buildCallbackMap(
  key: string,
  documents: readonly FixtureDocument[],
): Record<string, CallbackEntry[]> {
  return {
    [key]: documents.map((doc) => ({
      inputs: { fixture: doc.fixture },
      outputs: {
        matrix: JSON.stringify(doc.matrix),
        has_pypi: doc.has_pypi ? 'true' : 'false',
      },
    })),
  };
}
