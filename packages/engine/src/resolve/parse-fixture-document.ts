export interface FixtureDocument {
  fixture: string;
  matrix: unknown[];
  has_pypi: boolean;
}

/**
 * Validates one `piot-ci fixture-matrix` document. Strict on purpose:
 * a malformed document must abort the whole map (never a partial or
 * guessed entry — the map's only value is agreement with the live job).
 */
export function parseFixtureDocument(raw: string, fixture: string): FixtureDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`resolve: fixture-matrix emitted invalid JSON for '${fixture}'`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`resolve: fixture-matrix emitted a non-object for '${fixture}'`);
  }
  const doc = parsed as { fixture?: unknown; matrix?: unknown; has_pypi?: unknown };
  if (doc.fixture !== fixture || !Array.isArray(doc.matrix) || typeof doc.has_pypi !== 'boolean') {
    throw new Error(`resolve: fixture-matrix emitted an unexpected document for '${fixture}'`);
  }
  return { fixture, matrix: doc.matrix, has_pypi: doc.has_pypi };
}
