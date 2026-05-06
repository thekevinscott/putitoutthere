/**
 * Pre-flight checks. Run before any publish side effect.
 *
 * Auth (`requireAuth` / `checkAuth`) — every cascaded package has a
 * viable credentials path. Per plan.md §16.3: each handler accepts
 * OIDC (detected by `ACTIONS_ID_TOKEN_REQUEST_TOKEN`) or a specific
 * long-lived env var.
 *
 * npm provenance metadata (`requireProvenanceMetadata` /
 * `checkProvenanceMetadata`) — every npm package's `package.json`
 * carries a non-empty `repository` field. `npm publish --provenance`
 * (the OIDC trusted-publisher path) hard-requires this; failing
 * here, before runner work, beats failing deep inside the npm CLI
 * after artifact upload + OIDC negotiation. #280.
 *
 * Each function reports; callers decide whether to throw. The
 * `require*` variants are the publish path; the `check*` variants
 * exist so future diagnostic surfaces can render tables instead of
 * aborting.
 *
 * Issue #14, #280.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import type { Kind } from './types.js';

// Per-kind accepted env var names, primary first. `checkAuth` scans left
// to right and reports the first that has a non-empty value. npm takes
// two names because ecosystems have split on the convention:
//   - `NODE_AUTH_TOKEN` — `actions/setup-node`'s `.npmrc` template.
//   - `NPM_TOKEN` — widely used at the workflow step level and by
//     community tooling (semantic-release, lerna, etc.).
// Accepting both keeps the pre-flight accurate for adopters who expose
// their secret under either name. #95.
const TOKEN_ENV: Record<Kind, readonly string[]> = {
  crates: ['CARGO_REGISTRY_TOKEN'],
  pypi: ['PYPI_API_TOKEN'],
  npm: ['NODE_AUTH_TOKEN', 'NPM_TOKEN'],
};

const OIDC_ENV = 'ACTIONS_ID_TOKEN_REQUEST_TOKEN';
// Points consumers at the published auth guide, not internal plan docs
// (#144).
const DOCS_POINTER = 'https://thekevinscott.github.io/putitoutthere/guide/auth';

export interface AuthResult {
  package: string;
  kind: Kind;
  via: 'oidc' | 'token' | 'missing';
  /** The matched env var when via=token; the primary otherwise. */
  envVar: string;
  /** Every env var name the handler will accept for this kind. */
  acceptedEnvVars: readonly string[];
}

export interface AuthStatus {
  ok: boolean;
  results: AuthResult[];
}

export function checkAuth(packages: readonly Package[]): AuthStatus {
  const hasOidc = nonEmpty(process.env[OIDC_ENV]);
  const results: AuthResult[] = packages.map((p) => {
    const acceptedEnvVars = TOKEN_ENV[p.kind];
    const primary = acceptedEnvVars[0] as string;
    if (hasOidc) {
      return { package: p.name, kind: p.kind, via: 'oidc', envVar: primary, acceptedEnvVars };
    }
    const matched = acceptedEnvVars.find((name) => nonEmpty(process.env[name]));
    if (matched !== undefined) {
      return { package: p.name, kind: p.kind, via: 'token', envVar: matched, acceptedEnvVars };
    }
    return { package: p.name, kind: p.kind, via: 'missing', envVar: primary, acceptedEnvVars };
  });
  const ok = results.every((r) => r.via !== 'missing');
  return { ok, results };
}

export function requireAuth(packages: readonly Package[]): void {
  const status = checkAuth(packages);
  if (status.ok) return;
  const missing = status.results.filter((r) => r.via === 'missing');
  const lines = missing.map((r) => {
    const vars = r.acceptedEnvVars.join(' or ');
    return `  - ${r.package} (${r.kind}) needs ${vars} (or OIDC via ${OIDC_ENV})`;
  });
  throw new Error(
    [
      'Pre-flight auth check failed:',
      ...lines,
      '',
      `Wire the missing env vars in .github/workflows/release.yml under the publish job.`,
      `See ${DOCS_POINTER}.`,
    ].join('\n'),
  );
}

function nonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/* ----------------------- npm provenance metadata ----------------------- */

// Anchor for the README section that documents the field requirement.
// Surfaced verbatim in the thrown error so users have something
// actionable to follow rather than a code-search target.
const REPOSITORY_DOC_POINTER =
  'https://github.com/thekevinscott/putitoutthere#kind--npm';

export interface ProvenanceFinding {
  package: string;
  /** Pkg-relative `package.json` path examined. */
  packageJsonPath: string;
  /** Why the field is unusable: missing entirely, or empty/no-url. */
  reason: 'missing' | 'empty';
}

/**
 * Scan every npm package's `package.json` for a non-empty `repository`
 * field. Returns the list of findings; an empty list means every npm
 * package is well-formed.
 *
 * `repository` is accepted in either the canonical object form
 * (`{ type, url, directory? }`) or the legacy single-string form
 * (`"git+https://…"`). The string form must be non-empty after
 * trimming; the object form must carry a non-empty `url`.
 *
 * Non-npm packages and a malformed `package.json` (parse error) are
 * skipped — other parts of the pipeline already cover those failure
 * modes; this check is scoped to the `repository` field alone.
 */
export function checkProvenanceMetadata(
  packages: readonly Package[],
): ProvenanceFinding[] {
  const findings: ProvenanceFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'npm') continue;
    const pkgJsonPath = join(p.path, 'package.json');
    let raw: string;
    try {
      raw = readFileSync(pkgJsonPath, 'utf8');
    } catch {
      findings.push({ package: p.name, packageJsonPath: pkgJsonPath, reason: 'missing' });
      continue;
    }
    let parsed: { repository?: unknown };
    try {
      parsed = JSON.parse(raw) as { repository?: unknown };
    } catch {
      // A malformed package.json is a different failure surface;
      // leave it to the publish step to bubble up. This check only
      // owns the `repository` field.
      continue;
    }
    if (!hasNonEmptyRepository(parsed.repository)) {
      findings.push({ package: p.name, packageJsonPath: pkgJsonPath, reason: 'empty' });
    }
  }
  return findings;
}

function hasNonEmptyRepository(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value !== null && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    return typeof url === 'string' && url.trim().length > 0;
  }
  return false;
}

/**
 * Throw with an actionable error when any npm package's `package.json`
 * lacks a non-empty `repository` field. Reports every failing package
 * in one error rather than failing on the first, so consumers fix
 * them all in one round-trip.
 *
 * Always runs (not OIDC-gated): the README demands the field for
 * every npm publish, and `npm publish --provenance` is putitoutthere's
 * blessed publish mode. Even on the token path, missing `repository`
 * is a misconfiguration — fail fast.
 */
export function requireProvenanceMetadata(packages: readonly Package[]): void {
  const findings = checkProvenanceMetadata(packages);
  if (findings.length === 0) return;
  const lines: string[] = [
    `[${ErrorCodes.NPM_MISSING_REPOSITORY}] npm publish requires a non-empty \`repository\` field in package.json.`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(`  - ${f.package}: ${f.packageJsonPath} (${f.reason})`);
  }
  lines.push(
    '',
    'Why: `npm publish --provenance` (used by putitoutthere on the OIDC trusted-publisher',
    'path) hard-requires this field so npm can verify the package was built from the repo',
    'the trusted publisher declares.',
    '',
    'Fix: add a `repository` block to each failing package.json. Canonical shape:',
    '',
    '  {',
    '    "repository": {',
    '      "type": "git",',
    '      "url": "git+https://github.com/<owner>/<repo>.git",',
    '      "directory": "<path/to/package>"',
    '    }',
    '  }',
    '',
    `See ${REPOSITORY_DOC_POINTER}.`,
  );
  throw new Error(lines.join('\n'));
}
