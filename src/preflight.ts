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
import { dirname, join, parse as parsePath } from 'node:path';

import { parse as parseToml } from 'smol-toml';

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

/* ----------------------- crates.io required metadata ----------------------- */

// crates.io rejects publish with `400 Bad Request: missing or empty
// metadata fields: ...` when [package].description is empty/missing
// or when neither [package].license nor [package].license-file is set.
// The official cargo manifest reference for what's required vs.
// recommended.
const CARGO_DOC_POINTER =
  'https://doc.rust-lang.org/cargo/reference/manifest.html#package-metadata';

/** A required Cargo.toml `[package]` field that crates.io enforces. */
export type CratesRequiredField = 'description' | 'license';

export interface CratesMetadataFinding {
  package: string;
  /** Pkg-relative `Cargo.toml` path examined. */
  cargoTomlPath: string;
  /** Required fields that are missing or empty. */
  missing: readonly CratesRequiredField[];
}

/**
 * Scan every crates package's `Cargo.toml` for the metadata fields
 * crates.io hard-requires at publish time:
 *
 *   - `[package].description` — non-empty string.
 *   - `[package].license` OR `[package].license-file` — non-empty string.
 *
 * Returns the list of findings; an empty list means every crates
 * package is well-formed.
 *
 * Non-crates packages, missing `Cargo.toml`, and malformed TOML are
 * skipped — other parts of the pipeline already cover those failure
 * modes; this check is scoped to the metadata fields alone.
 */
export function checkCratesMetadata(
  packages: readonly Package[],
): CratesMetadataFinding[] {
  const findings: CratesMetadataFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'crates') continue;
    const cargoTomlPath = join(p.path, 'Cargo.toml');
    let raw: string;
    try {
      raw = readFileSync(cargoTomlPath, 'utf8');
    } catch {
      // The crates handler surfaces "Cargo.toml not found" with a
      // clear error; this check owns metadata fields, not file
      // existence. Skip.
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(raw);
    } catch {
      // Malformed TOML — cargo's own parser will surface it with a
      // useful diagnostic. Skip.
      continue;
    }
    const pkgTable = (parsed.package ?? {}) as Record<string, unknown>;
    // `[workspace.package]` inheritance (#328): cargo resolves
    // `license.workspace = true` against the workspace root before
    // upload, so the literal value lands on crates.io. The check has
    // to do the same — otherwise crates following Cargo's recommended
    // centralized-metadata pattern false-positive.
    const wsPkgTable = readWorkspacePackageTable(p.path);
    const description = resolveInherited(pkgTable.description, wsPkgTable, 'description');
    const license = resolveInherited(pkgTable.license, wsPkgTable, 'license');
    const licenseFile = resolveInherited(
      pkgTable['license-file'],
      wsPkgTable,
      'license-file',
    );
    const missing: CratesRequiredField[] = [];
    if (!nonEmptyString(description)) missing.push('description');
    if (!nonEmptyString(license) && !nonEmptyString(licenseFile)) {
      missing.push('license');
    }
    if (missing.length > 0) {
      findings.push({ package: p.name, cargoTomlPath, missing });
    }
  }
  return findings;
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Return the inherited workspace value when the field is declared as
 * `<field>.workspace = true`; otherwise pass the raw value through.
 * `wsPkgTable` is `undefined` when no parent `Cargo.toml` declares a
 * `[workspace.package]` block — inheritance simply yields `undefined`
 * there, which `nonEmptyString` correctly treats as missing.
 */
function resolveInherited(
  value: unknown,
  wsPkgTable: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).workspace === true
  ) {
    return wsPkgTable?.[key];
  }
  return value;
}

/**
 * Find the nearest parent `Cargo.toml` whose `[workspace]` table makes
 * it a workspace root and return its `[workspace.package]` table (if
 * any). Walks up from `crateDir` to the filesystem root. Returns
 * `undefined` when no workspace root is found or when the workspace
 * defines no shared `[workspace.package]` metadata.
 */
function readWorkspacePackageTable(
  crateDir: string,
): Record<string, unknown> | undefined {
  const rootMarker = parsePath(crateDir).root;
  let dir = dirname(crateDir);
  while (dir && dir !== rootMarker) {
    const manifest = join(dir, 'Cargo.toml');
    let raw: string;
    try {
      raw = readFileSync(manifest, 'utf8');
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(raw);
    } catch {
      // Cargo will surface the parser error; just skip this manifest
      // for workspace lookup so we don't crash on a malformed parent.
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }
    if (parsed.workspace !== undefined) {
      const ws = parsed.workspace as Record<string, unknown>;
      const wsPkg = ws.package;
      if (wsPkg !== undefined && typeof wsPkg === 'object') {
        return wsPkg as Record<string, unknown>;
      }
      // Workspace root found, but no shared metadata — stop walking.
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Throw with an actionable error when any crates package's Cargo.toml
 * lacks a required `[package]` metadata field. Reports every failing
 * package + missing fields in one error rather than failing on the
 * first, so consumers fix them all in one round-trip.
 *
 * Why: crates.io's 400 lands after `cargo publish`'s verification
 * build has compiled the crate and every transitive dep — wasting
 * the entire publish job on a precondition checkable in milliseconds.
 * #290.
 */
export function requireCratesMetadata(packages: readonly Package[]): void {
  const findings = checkCratesMetadata(packages);
  if (findings.length === 0) return;
  const lines: string[] = [
    `[${ErrorCodes.CRATES_MISSING_METADATA}] cargo publish requires the following Cargo.toml [package] fields: description, and license (or license-file).`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(
      `  - ${f.package}: ${f.cargoTomlPath} (missing: ${f.missing.join(', ')})`,
    );
  }
  lines.push(
    '',
    'Why: crates.io rejects publish with `400 Bad Request: missing or empty',
    'metadata fields: ...` after cargo publish has compiled the crate and every',
    'transitive dep — wasting the full publish job on a precondition checkable',
    'in milliseconds.',
    '',
    'Fix: add the missing fields to each Cargo.toml. Example:',
    '',
    '  [package]',
    '  description = "One-line summary of what the crate does."',
    '  license = "MIT OR Apache-2.0"',
    '',
    `See ${CARGO_DOC_POINTER}.`,
  );
  throw new Error(lines.join('\n'));
}
