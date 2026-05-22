/**
 * Python-version resolution for `kind = "pypi"` packages.
 *
 * `kind = "pypi"` builds a wheel for every CPython version a package
 * supports, not just one. The version set is resolved per package:
 *
 *  1. An explicit `python_versions` array in `putitoutthere.toml`.
 *  2. Otherwise, inferred from `[project].requires-python` in the
 *     consumer's `pyproject.toml`.
 *  3. Otherwise, a single default version.
 *
 * The planner fans the pypi build matrix across the resolved set so
 * consumers whose `requires-python` spans multiple versions ship
 * complete wheel coverage with zero configuration. Issue #369.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

/**
 * Released CPython minor versions piot expands `requires-python`
 * against. Ascending. A `requires-python` clause selects a subset of
 * this list; versions outside it (pre-releases, EOL-and-pre-3.8,
 * unreleased) are never inferred. Bump the tail when a new CPython
 * ships and consumers want coverage for it without pinning
 * `python_versions` by hand.
 */
export const KNOWN_PYTHON_VERSIONS = [
  '3.8',
  '3.9',
  '3.10',
  '3.11',
  '3.12',
  '3.13',
] as const;

/**
 * Fallback when neither `python_versions` nor a parseable
 * `requires-python` is available — preserves the single-wheel
 * behavior piot had before #369.
 */
export const DEFAULT_PYTHON_VERSION = '3.12';

/** Parse `"3.10.1"` → `[3, 10, 1]`. */
function parseVersion(s: string): number[] {
  return s.split('.').map((p) => Number.parseInt(p, 10));
}

/** Lexicographic compare of two version tuples, zero-padding the shorter. */
function cmp(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

interface Clause {
  op: string;
  version: string;
}

// PEP 440 version-specifier operators, longest-first so `>=` wins over `>`.
const CLAUSE_RE = /(===|==|!=|~=|>=|<=|>|<)\s*([0-9][0-9.]*\*?)/g;

function parseClauses(spec: string): Clause[] {
  const clauses: Clause[] = [];
  for (const m of spec.matchAll(CLAUSE_RE)) {
    clauses.push({ op: m[1]!, version: m[2]! });
  }
  return clauses;
}

type OpFn = (candidate: readonly number[], ver: readonly number[]) => boolean;

// One predicate per PEP 440 specifier operator. The keys are exactly
// the alternatives in CLAUSE_RE, so every parsed clause's `op` maps to
// an entry here.
const OPERATORS: Record<string, OpFn> = {
  '>=': (c, v) => cmp(c, v) >= 0,
  '>': (c, v) => cmp(c, v) > 0,
  '<=': (c, v) => cmp(c, v) <= 0,
  '<': (c, v) => cmp(c, v) < 0,
  // Compatible release: `>=v` within the same leading component.
  '~=': (c, v) => cmp(c, v) >= 0 && c[0] === v[0],
  // Exact / prefix match at the precision the clause specifies.
  '==': (c, v) => cmp(c.slice(0, v.length), v) === 0,
  '===': (c, v) => cmp(c.slice(0, v.length), v) === 0,
  '!=': (c, v) => cmp(c.slice(0, v.length), v) !== 0,
};

/** Does a candidate `[major, minor]` satisfy one specifier clause? */
function satisfies(candidate: readonly number[], clause: Clause): boolean {
  const wildcard = clause.version.endsWith('.*');
  const ver = parseVersion(wildcard ? clause.version.slice(0, -2) : clause.version);
  return OPERATORS[clause.op]!(candidate, ver);
}

/**
 * Expand a `requires-python` specifier to the concrete CPython
 * versions from {@link KNOWN_PYTHON_VERSIONS} it allows. `">=3.10"`
 * → `["3.10", "3.11", "3.12", "3.13"]`. Returns `[]` when the spec
 * is empty or carries no recognizable clause, so callers can fall
 * back.
 */
export function expandRequiresPython(spec: string): string[] {
  const clauses = parseClauses(spec);
  if (clauses.length === 0) return [];
  return KNOWN_PYTHON_VERSIONS.filter((kv) => {
    const candidate = parseVersion(kv);
    return clauses.every((clause) => satisfies(candidate, clause));
  });
}

/** Ascending numeric comparator for `"3.x"` version strings. */
function compareVersionStrings(a: string, b: string): number {
  return cmp(parseVersion(a), parseVersion(b));
}

/** Read `[project].requires-python` from a `pyproject.toml`, or `null`. */
function readRequiresPython(pyprojectPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(pyprojectPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw);
  } catch {
    return null;
  }
  const project = parsed.project;
  if (typeof project !== 'object') return null;
  const req = (project as Record<string, unknown>)['requires-python'];
  return typeof req === 'string' ? req : null;
}

/**
 * Resolve the ascending set of CPython versions a pypi package's
 * wheels should be built for. Config override wins; otherwise
 * `requires-python` is inferred; otherwise a single default.
 */
export function resolvePythonVersions(
  pkg: { path: string; python_versions?: readonly string[] | undefined },
  cwd: string,
): string[] {
  if (pkg.python_versions !== undefined) {
    return [...pkg.python_versions].sort(compareVersionStrings);
  }
  const requiresPython = readRequiresPython(join(cwd, pkg.path, 'pyproject.toml'));
  if (requiresPython !== null) {
    const expanded = expandRequiresPython(requiresPython);
    if (expanded.length > 0) return expanded;
  }
  return [DEFAULT_PYTHON_VERSION];
}
