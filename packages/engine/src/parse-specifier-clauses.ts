import type { SpecifierClause } from './python-versions-types.js';

export function parseSpecifierClauses(spec: string): SpecifierClause[] {
  const clauses: SpecifierClause[] = [];
  for (const m of spec.matchAll(/(===|==|!=|~=|>=|<=|>|<)\s*([0-9][0-9.]*\*?)/g)) {
    clauses.push({ op: m[1]!, version: m[2]! });
  }
  return clauses;
}
