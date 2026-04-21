/**
 * Token scope checking — compares what a token is allowed to publish
 * against what `putitoutthere.toml` says the package is.
 *
 * Runs as a deep extension of `doctor` (#110) and as an opt-in gate in
 * `publish --preflight-check`. Per registry:
 *
 *   - PyPI: project-name macaroon caveats. Full-scope tokens pass; any
 *     restriction list that excludes the package name is a hard
 *     mismatch.
 *   - npm:  granular `pkg:<name>` scopes on the matched tokens row. A
 *     bare `@scope` grant still counts when the package name lives
 *     under that scope. Legacy (non-granular) tokens are treated as
 *     full-scope (`match: 'ok'`, note surfaced).
 *   - crates.io: the bearer row is not identifiable, so we can never
 *     prove mismatch. Always `match: 'unknown'` — callers that need a
 *     block/warn decision should treat `unknown` as warn-only.
 *
 * Never logs or returns token values. Digests are threaded through from
 * `inspect` for traceability.
 */

import { inspect as realInspect, isError } from './token.js';
import type {
  InspectOptions,
  InspectResult,
  NpmInspectResult,
  PypiInspectResult,
} from './token.js';
import type { Package } from './config.js';
import type { Kind } from './types.js';

export type ScopeMatch = 'ok' | 'mismatch' | 'unknown' | 'error';

export interface DeepCheckRow {
  package: string;
  kind: Kind;
  scope: string;
  match: ScopeMatch;
  /** Populated on mismatch or error; omitted when `ok` / `unknown`. */
  detail?: string;
}

export type InspectFn = (opts: InspectOptions) => Promise<InspectResult>;

/**
 * Registry-facing publish name. Handlers use the override field when
 * present; we mirror that so the scope check talks about the same name
 * the upload will use.
 */
export function publishNameFor(pkg: Package): string {
  if (pkg.kind === 'pypi') return pkg.pypi ?? pkg.name;
  if (pkg.kind === 'npm') return pkg.npm ?? pkg.name;
  return pkg.crate ?? pkg.name;
}

export interface ScopeFromResult {
  scope: string;
  match: ScopeMatch;
  detail?: string;
}

/**
 * Translate an `InspectResult` + the package it's meant to publish into
 * a scope display + match verdict. Pure; never hits the network.
 */
export function scopeFromInspect(result: InspectResult, pkg: Package): ScopeFromResult {
  if (isError(result)) {
    return { scope: '(inspect failed)', match: 'error', detail: result.error };
  }

  if (result.registry === 'pypi') return scopeFromPypi(result, pkg);
  if (result.registry === 'npm') return scopeFromNpm(result, pkg);
  // crates.io: we can't prove mismatch.
  return { scope: 'unknown (see account tokens)', match: 'unknown' };
}

function scopeFromPypi(result: PypiInspectResult, pkg: Package): ScopeFromResult {
  const allowed = collectPypiProjectNames(result);
  if (allowed === null) {
    return { scope: '(full-scope)', match: 'ok' };
  }
  const want = publishNameFor(pkg);
  if (allowed.includes(want)) {
    return { scope: `projects=[${allowed.join(', ')}]`, match: 'ok' };
  }
  return {
    scope: `projects=[${allowed.join(', ')}]`,
    match: 'mismatch',
    detail: `PyPI token restricted to [${allowed.join(', ')}] but config publishes '${want}'`,
  };
}

function collectPypiProjectNames(result: PypiInspectResult): string[] | null {
  const names: string[] = [];
  let sawProjectRestriction = false;
  for (const r of result.restrictions) {
    if (r.type === 'ProjectNames') {
      sawProjectRestriction = true;
      for (const n of r.names) names.push(n);
    }
  }
  return sawProjectRestriction ? dedupe(names) : null;
}

function scopeFromNpm(result: NpmInspectResult, pkg: Package): ScopeFromResult {
  const want = publishNameFor(pkg);
  const row = result.scope_row;

  if (row === null) {
    // Legacy UUID or non-granular token: we can't introspect scope.
    // Treat as full-scope ok; doctor will still flag via note.
    return { scope: `(${result.format}; no scope row)`, match: 'ok' };
  }

  const allowedPkgs = row.packages ?? [];
  const allowedScopes = (row.scopes ?? []).map((s) => (s.startsWith('@') ? s : `@${s}`));
  const allowedOrgs = row.orgs ?? [];

  const noRestrictions =
    allowedPkgs.length === 0 && allowedScopes.length === 0 && allowedOrgs.length === 0;
  if (noRestrictions) {
    return { scope: '(account-wide)', match: 'ok' };
  }

  if (allowedPkgs.includes(want)) {
    return { scope: renderNpmScope(row), match: 'ok' };
  }
  const atScope = scopeOf(want);
  if (atScope !== null && allowedScopes.includes(atScope)) {
    return { scope: renderNpmScope(row), match: 'ok' };
  }
  // Orgs aren't a pre-publish allowlist at the name level (npm doesn't
  // bind "org:foo" to a package name directly), so we don't use them to
  // prove a match. We still render them for visibility.
  return {
    scope: renderNpmScope(row),
    match: 'mismatch',
    detail: `npm token allowlist [${[...allowedPkgs, ...allowedScopes].join(', ')}] does not include '${want}'`,
  };
}

function renderNpmScope(row: NonNullable<NpmInspectResult['scope_row']>): string {
  const parts: string[] = [];
  if (row.packages && row.packages.length > 0) parts.push(`pkgs=[${row.packages.join(', ')}]`);
  if (row.scopes && row.scopes.length > 0) parts.push(`scopes=[${row.scopes.join(', ')}]`);
  if (row.orgs && row.orgs.length > 0) parts.push(`orgs=[${row.orgs.join(', ')}]`);
  /* v8 ignore next -- caller only invokes this when at least one list is populated */
  return parts.length === 0 ? '(empty)' : parts.join(' ');
}

function scopeOf(name: string): string | null {
  if (!name.startsWith('@')) return null;
  const slash = name.indexOf('/');
  /* v8 ignore next -- scoped npm names always carry a slash separator */
  return slash === -1 ? null : name.slice(0, slash);
}

function dedupe<T>(arr: readonly T[]): T[] {
  return Array.from(new Set(arr));
}

/* ----------------------- orchestration (IO side) ---------------------- */

export interface DeepCheckOptions {
  packages: readonly Package[];
  /** envVar-per-package mapping, as computed by preflight.checkAuth. */
  envVarForPackage: Map<string, string>;
  env?: NodeJS.ProcessEnv;
  /** Override for tests; defaults to the real `inspect`. */
  inspect?: InspectFn;
}

/**
 * Call `inspect` for every package that has a resolvable token in the
 * env, and return one `DeepCheckRow` per package. Packages whose env
 * var is absent or empty are emitted with `match: 'error'`.
 */
export async function deepCheck(opts: DeepCheckOptions): Promise<DeepCheckRow[]> {
  const env = opts.env ?? process.env;
  const inspectFn = opts.inspect ?? realInspect;

  const rows: DeepCheckRow[] = [];
  for (const pkg of opts.packages) {
    const envVar = opts.envVarForPackage.get(pkg.name);
    const tokenValue = envVar !== undefined ? env[envVar] : undefined;
    if (tokenValue === undefined || tokenValue.trim() === '') {
      rows.push({
        package: pkg.name,
        kind: pkg.kind,
        scope: '(no token resolved)',
        match: 'error',
        detail: `no token value found in ${envVar ?? '<unknown env var>'}`,
      });
      continue;
    }
    const result = await inspectFn({ token: tokenValue, registry: pkg.kind });
    const verdict = scopeFromInspect(result, pkg);
    rows.push({
      package: pkg.name,
      kind: pkg.kind,
      scope: verdict.scope,
      match: verdict.match,
      ...(verdict.detail !== undefined ? { detail: verdict.detail } : {}),
    });
  }
  return rows;
}
