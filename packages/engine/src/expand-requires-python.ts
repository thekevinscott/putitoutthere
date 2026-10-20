import { parsePythonVersion } from './parse-python-version.js';
import { parseSpecifierClauses } from './parse-specifier-clauses.js';
import { satisfiesClause } from './satisfies-clause.js';

export function expandRequiresPython(spec: string): string[] {
  const released = ['3.8', '3.9', '3.10', '3.11', '3.12', '3.13', '3.14'];
  const clauses = parseSpecifierClauses(spec);
  if (clauses.length === 0) {return [];}
  return released.filter((kv) => {
    const candidate = parsePythonVersion(kv);
    return clauses.every((clause) => satisfiesClause(candidate, clause));
  });
}
