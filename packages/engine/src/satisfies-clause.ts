import { compareVersionTuples as cmp } from './compare-version-tuples.js';
import { parsePythonVersion } from './parse-python-version.js';
import type { SpecifierClause, VersionPredicate } from './python-versions-types.js';

export function satisfiesClause(candidate: readonly number[], clause: SpecifierClause): boolean {
  const operators: Record<string, VersionPredicate> = {
    '>=': (c, v) => cmp(c, v) >= 0,
    '>': (c, v) => cmp(c, v) > 0,
    '<=': (c, v) => cmp(c, v) <= 0,
    '<': (c, v) => cmp(c, v) < 0,
    '~=': (c, v) => cmp(c, v) >= 0 && c[0] === v[0],
    '==': (c, v) => cmp(c.slice(0, v.length), v) === 0,
    '===': (c, v) => cmp(c.slice(0, v.length), v) === 0,
    '!=': (c, v) => cmp(c.slice(0, v.length), v) !== 0,
  };
  const wildcard = clause.version.endsWith('.*');
  const ver = parsePythonVersion(wildcard ? clause.version.slice(0, -2) : clause.version);
  return operators[clause.op]!(candidate, ver);
}
