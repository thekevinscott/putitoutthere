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
import { dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import { expandDirGlob } from './glob.js';
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
  if (status.ok) {return;}
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
    if (p.kind !== 'npm') {continue;}
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
  if (typeof value === 'string') {return value.trim().length > 0;}
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
  if (findings.length === 0) {return;}
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
    if (p.kind !== 'crates') {continue;}
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
    if (!nonEmptyString(description)) {missing.push('description');}
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

/* ----------------------- pypi dynamic version ----------------------- */

// User-facing recipe for hatch-vcs adoption. Embedded verbatim in the
// thrown error so users have a copy/paste fix instead of a doc-search
// target.
const PYPI_VERSION_DOC_POINTER =
  'https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions';

export interface PypiVersionFinding {
  package: string;
  /** Pkg-relative `pyproject.toml` path examined. */
  pyprojectPath: string;
}

/**
 * Scan every pypi package's `pyproject.toml` for a static
 * `[project].version = "..."` literal. Returns the list of findings;
 * an empty list means every pypi package declares
 * `[project].dynamic = ["version"]` (or has no `[project]` table at
 * all — that case is reported by a different check).
 *
 * Why: a static literal silently ships the previous release. The build
 * backend reads pyproject.toml at build time and putitoutthere does not
 * rewrite the literal (per design-commitment #1, no version
 * computation). hatch-vcs / setuptools-scm derive the version from a
 * git tag or `SETUPTOOLS_SCM_PRETEND_VERSION`; for maturin, the
 * version flows from `Cargo.toml`'s `[package].version`. All three
 * accept `dynamic = ["version"]`.
 *
 * Non-pypi packages, a missing `pyproject.toml`, malformed TOML, and a
 * `pyproject.toml` with no `[project]` table are skipped — other parts
 * of the pipeline (`checkPyprojectAndBundleCli`, the handler's own
 * read) already surface those failure modes.
 */
export function checkPypiVersionSource(
  packages: readonly Package[],
): PypiVersionFinding[] {
  const findings: PypiVersionFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    let raw: string;
    try {
      raw = readFileSync(pyprojectPath, 'utf8');
    } catch {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(raw);
    } catch {
      continue;
    }
    const project = parsed.project as
      | { version?: unknown; dynamic?: unknown }
      | undefined;
    if (project === undefined) {continue;}
    if (declaresDynamicVersion(project)) {continue;}
    if (typeof project.version === 'string') {
      findings.push({ package: p.name, pyprojectPath });
    }
  }
  return findings;
}

function declaresDynamicVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}

/**
 * Throw with an actionable error when any pypi package's pyproject.toml
 * declares a static `[project].version` literal. Reports every failing
 * package in one error rather than failing on the first, so consumers
 * fix them all in one round-trip.
 *
 * The fix shape is the same across hatch-vcs, setuptools-scm, and
 * maturin: declare `dynamic = ["version"]` and let the build backend
 * derive the version from a tagged source (git tag,
 * `SETUPTOOLS_SCM_PRETEND_VERSION`, or sibling `Cargo.toml`).
 */
export function requirePypiVersionSource(packages: readonly Package[]): void {
  const findings = checkPypiVersionSource(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    `[${ErrorCodes.PYPI_STATIC_VERSION}] pyproject.toml must declare \`[project].dynamic = ["version"]\` instead of a static \`[project].version = "..."\` literal.`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(`  - ${f.package}: ${f.pyprojectPath}`);
  }
  lines.push(
    '',
    'Why: putitoutthere does not edit pyproject.toml at release time (per the',
    '"no version computation" design commitment). A static literal silently',
    'ships the previous release\'s wheel/sdist, because the build backend reads',
    'whatever is on disk.',
    '',
    'Recommended fix (hatch-vcs):',
    '',
    '  [build-system]',
    '  requires = ["hatchling", "hatch-vcs"]',
    '  build-backend = "hatchling.build"',
    '',
    '  [project]',
    '  name = "<your-package>"',
    '  dynamic = ["version"]',
    '',
    '  [tool.hatch.version]',
    '  source = "vcs"',
    '',
    'setuptools-scm and the maturin (Cargo.toml-driven) path are equally',
    `valid — see ${PYPI_VERSION_DOC_POINTER}.`,
  );
  throw new Error(lines.join('\n'));
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
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = parseToml(readFileSync(manifest, 'utf8'));
    } catch {
      // Missing or malformed Cargo.toml at this level — skip it and keep
      // walking up. (Cargo surfaces a real parse error itself; we just
      // don't crash the workspace lookup on an unreadable ancestor.)
      parsed = undefined;
    }
    if (parsed !== undefined && parsed.workspace !== undefined) {
      const ws = parsed.workspace as Record<string, unknown>;
      const wsPkg = ws.package;
      if (wsPkg !== undefined && typeof wsPkg === 'object') {
        return wsPkg as Record<string, unknown>;
      }
      // Workspace root found, but no shared metadata — stop walking.
      return undefined;
    }
    // Advance one directory toward the filesystem root. The fixpoint
    // guard terminates the walk for relative crate paths, where
    // dirname() settles on '.' rather than reaching rootMarker.
    const parent = dirname(dir);
    if (parent === dir) {break;}
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
  if (findings.length === 0) {return;}
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

/* ----------------------- pyproject.toml + Cargo.toml shape (#301) ----------------------- */
//
// Mirrors the #280 / #290 pattern for pypi + crates shape gates that
// would otherwise surface 10-20 minutes into a release run when the
// build tool finally tripped on them. Each check fingerprints a
// confusing tail-end error with a stable PIOT_ code so foreign-agent
// debugging can grep the run log.

export type PypiShapeCode =
  | 'PIOT_PYPI_NAME_MISMATCH'
  | 'PIOT_PYPI_BUILD_BACKEND_MISMATCH'
  | 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND'
  | 'PIOT_PYPI_MATURIN_INCLUDE_MISSING';

export interface PyprojectShapeFinding {
  package: string;
  pyprojectPath: string;
  code: PypiShapeCode;
  detail: string;
}

export type CratesShapeCode =
  | 'PIOT_CRATES_NAME_MISMATCH'
  | 'PIOT_CRATES_MISSING_BIN'
  | 'PIOT_CRATES_FEATURE_NOT_DECLARED'
  | 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH';

export interface CargoShapeFinding {
  package: string;
  cargoTomlPath: string;
  code: CratesShapeCode;
  detail: string;
}

export interface CargoShapeOptions {
  /** Used to resolve `bundle_cli.crate_path` (documented as relative
   *  to the repo root) and to bound the workspace-version walk.
   *  Defaults to `process.cwd()`. */
  cwd?: string;
}

// Each PYPI_BUILD mode maps to the prefix(es) the upstream build
// backend identifier should start with. The check is intentionally
// loose: maturin / setuptools / hatchling all ship multiple backend
// identifiers across versions, and the failure mode this gate exists
// to catch is the *kind* mismatch (e.g. `build = "maturin"` but the
// pyproject declares hatchling), not a backend-version drift.
const PYPI_BACKEND_PREFIX: Record<'maturin' | 'setuptools' | 'hatch', readonly string[]> = {
  maturin: ['maturin'],
  setuptools: ['setuptools'],
  hatch: ['hatchling', 'hatch'],
};

export function checkPyprojectShape(
  packages: readonly Package[],
): PyprojectShapeFinding[] {
  const findings: PyprojectShapeFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    let raw: string;
    try {
      raw = readFileSync(pyprojectPath, 'utf8');
    } catch {
      // Missing pyproject.toml is a different failure surface (the
      // build tool surfaces it with a clear error, and `check.ts`
      // catches it at PR time). Skip.
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(raw);
    } catch {
      // Malformed TOML — let the build tool surface its own diagnostic.
      continue;
    }

    const project = (parsed.project ?? {}) as Record<string, unknown>;
    const buildSystem = (parsed['build-system'] ?? {}) as Record<string, unknown>;
    const tool = (parsed.tool ?? {}) as Record<string, unknown>;
    const expectedName = p.pypi ?? p.name;

    // PYPI_NAME_MISMATCH
    if (typeof project.name === 'string' && project.name !== expectedName) {
      findings.push({
        package: p.name,
        pyprojectPath,
        code: 'PIOT_PYPI_NAME_MISMATCH',
        detail: `[project].name = "${project.name}" but configured name is "${expectedName}"`,
      });
    }

    // PYPI_BUILD_BACKEND_MISMATCH — only fires when the field is set
    // *and* disagrees. A missing [build-system] table is technically
    // allowed (pip falls back to setuptools); flagging it here would
    // create noise on packages this gate is not meant to police.
    const backend = buildSystem['build-backend'];
    if (typeof backend === 'string' && backend.length > 0) {
      const allowed = PYPI_BACKEND_PREFIX[p.build];
      const ok = allowed.some((prefix) => backend.startsWith(prefix));
      if (!ok) {
        findings.push({
          package: p.name,
          pyprojectPath,
          code: 'PIOT_PYPI_BUILD_BACKEND_MISMATCH',
          detail: `[build-system].build-backend = "${backend}" but build = "${p.build}" expects ${allowed.map((a) => `"${a}*"`).join(' or ')}`,
        });
      }
    }

    // PYPI_DYNAMIC_VERSION_NO_BACKEND — only checks setuptools / hatch.
    // Maturin sources its version from Cargo.toml's [package].version
    // when `dynamic = ["version"]`, so requiring a `[tool.hatch.version]`
    // or `[tool.setuptools_scm]` block would surface false positives on
    // every maturin pypi package.
    if (p.build !== 'maturin') {
      const dynamic = project.dynamic;
      const dynamicHasVersion =
        Array.isArray(dynamic) && dynamic.some((v) => v === 'version');
      if (dynamicHasVersion) {
        const hatchVersion = ((tool.hatch ?? {}) as Record<string, unknown>).version;
        const setuptoolsScm = tool.setuptools_scm;
        const hasHatchSource = typeof hatchVersion === 'object' && hatchVersion !== null;
        const hasSetuptoolsScm = typeof setuptoolsScm === 'object' && setuptoolsScm !== null;
        if (!hasHatchSource && !hasSetuptoolsScm) {
          findings.push({
            package: p.name,
            pyprojectPath,
            code: 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND',
            detail:
              '[project].dynamic includes "version" but neither [tool.hatch.version] nor [tool.setuptools_scm] is present; the build backend has no way to compute a version',
          });
        }
      }
    }

    // PYPI_MATURIN_INCLUDE_MISSING
    if (p.bundle_cli !== undefined) {
      const stageTo = p.bundle_cli.stage_to;
      const maturin = (tool.maturin ?? {}) as Record<string, unknown>;
      const include = maturin.include;
      const includes = Array.isArray(include) ? include : [];
      if (!maturinIncludeCovers(includes, stageTo)) {
        findings.push({
          package: p.name,
          pyprojectPath,
          code: 'PIOT_PYPI_MATURIN_INCLUDE_MISSING',
          detail: `bundle_cli.stage_to = "${stageTo}" is not covered by any [tool.maturin].include entry; the cross-compiled binary will not be packed into the wheel`,
        });
      }
    }
  }
  return findings;
}

function maturinIncludeCovers(includes: readonly unknown[], stageTo: string): boolean {
  for (const entry of includes) {
    const path = extractIncludePath(entry);
    if (path === undefined) {continue;}
    // Strip trailing glob segments so `a/bin/*` and `a/bin/**` both
    // cover `a/bin`.
    const normalized = path.replace(/\/?\*+$/, '').replace(/\/$/, '');
    if (normalized === stageTo) {return true;}
    if (normalized.length > 0 && stageTo.startsWith(normalized + '/')) {return true;}
    if (path.startsWith(stageTo + '/') || path === stageTo) {return true;}
  }
  return false;
}

function extractIncludePath(entry: unknown): string | undefined {
  if (typeof entry === 'string') {return entry;}
  if (typeof entry === 'object' && entry !== null) {
    const path = (entry as { path?: unknown }).path;
    if (typeof path === 'string') {return path;}
  }
  return undefined;
}

export function requirePyprojectShape(packages: readonly Package[]): void {
  const findings = checkPyprojectShape(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    'Pre-flight pyproject.toml shape check failed:',
    '',
  ];
  for (const f of findings) {
    lines.push(`  [${f.code}] ${f.package}: ${f.pyprojectPath}`);
    lines.push(`    ${f.detail}`);
  }
  lines.push(
    '',
    'Why: these mismatches would otherwise surface 10-20 minutes into a release run',
    'when the build backend (maturin / setuptools / hatchling) finally tripped on them.',
    'Fix the pyproject.toml + putitoutthere.toml fields in this list, then re-run.',
  );
  throw new Error(lines.join('\n'));
}

export function checkCargoShape(
  packages: readonly Package[],
  options: CargoShapeOptions = {},
): CargoShapeFinding[] {
  const findings: CargoShapeFinding[] = [];
  const cwd = options.cwd ?? process.cwd();
  for (const p of packages) {
    if (p.kind === 'crates') {
      collectCratesPackageFindings(p, cwd, findings);
    } else if (p.kind === 'pypi' && p.bundle_cli !== undefined) {
      collectBundleCliCrateFindings(p, p.bundle_cli, cwd, findings);
    }
  }
  return findings;
}

function collectCratesPackageFindings(
  p: Package & { kind: 'crates' },
  cwd: string,
  findings: CargoShapeFinding[],
): void {
  const cargoTomlPath = join(p.path, 'Cargo.toml');
  const parsed = readToml(cargoTomlPath);
  if (parsed === null) {return;}
  const pkgTable = (parsed.package ?? {}) as Record<string, unknown>;
  const expectedName = p.crate ?? p.name;

  // CRATES_NAME_MISMATCH
  if (typeof pkgTable.name === 'string' && pkgTable.name !== expectedName) {
    findings.push({
      package: p.name,
      cargoTomlPath,
      code: 'PIOT_CRATES_NAME_MISMATCH',
      detail: `[package].name = "${pkgTable.name}" but configured name is "${expectedName}"`,
    });
  }

  // CRATES_FEATURE_NOT_DECLARED — only when features is set on the
  // configured package.
  if (p.features !== undefined && p.features.length > 0) {
    const declared = declaredFeatures(parsed);
    const missing = p.features.filter((f) => !declared.has(f));
    if (missing.length > 0) {
      findings.push({
        package: p.name,
        cargoTomlPath,
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: `features = ${JSON.stringify(p.features)} references undeclared feature(s) ${JSON.stringify(missing)}; Cargo.toml [features] declares ${JSON.stringify([...declared])}`,
      });
    }
  }

  // CRATES_WORKSPACE_VERSION_MISMATCH
  if (versionInheritsWorkspace(pkgTable.version)) {
    if (!workspaceVersionDeclared(cargoTomlPath, cwd)) {
      findings.push({
        package: p.name,
        cargoTomlPath,
        code: 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH',
        detail:
          '[package].version.workspace = true but no ancestor Cargo.toml declares [workspace.package].version',
      });
    }
  }
}

function collectBundleCliCrateFindings(
  p: Package & { kind: 'pypi' },
  bundleCli: NonNullable<(Package & { kind: 'pypi' })['bundle_cli']>,
  cwd: string,
  findings: CargoShapeFinding[],
): void {
  const cratePathAbs = isAbsolute(bundleCli.crate_path)
    ? bundleCli.crate_path
    : resolve(cwd, bundleCli.crate_path);
  const cargoTomlPath = join(cratePathAbs, 'Cargo.toml');
  const parsed = readToml(cargoTomlPath);
  if (parsed === null) {return;}

  // CRATES_MISSING_BIN
  const declaredBins = readDeclaredBinNames(parsed, cargoTomlPath);
  if (!declaredBins.includes(bundleCli.bin)) {
    findings.push({
      package: p.name,
      cargoTomlPath,
      code: 'PIOT_CRATES_MISSING_BIN',
      detail: `bundle_cli.bin = "${bundleCli.bin}" is not declared as a [[bin]] in ${cargoTomlPath}; declared bins: ${declaredBins.length === 0 ? '(none)' : declaredBins.join(', ')}`,
    });
  }

  // CRATES_FEATURE_NOT_DECLARED — bundle_cli.features path
  if (bundleCli.features.length > 0) {
    const declared = declaredFeatures(parsed);
    const missing = bundleCli.features.filter((f) => !declared.has(f));
    if (missing.length > 0) {
      findings.push({
        package: p.name,
        cargoTomlPath,
        code: 'PIOT_CRATES_FEATURE_NOT_DECLARED',
        detail: `bundle_cli.features = ${JSON.stringify(bundleCli.features)} references undeclared feature(s) ${JSON.stringify(missing)}; Cargo.toml [features] declares ${JSON.stringify([...declared])}`,
      });
    }
  }
}

function readToml(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseToml(raw);
  } catch {
    return null;
  }
}

function declaredFeatures(cargoToml: Record<string, unknown>): Set<string> {
  const features = (cargoToml.features ?? {}) as Record<string, unknown>;
  return new Set(Object.keys(features));
}

function readDeclaredBinNames(
  cargoToml: Record<string, unknown>,
  cargoTomlPath: string,
): string[] {
  const result = collectBinsFromManifest(cargoToml);
  // Workspace manifests delegate [[bin]] declarations to member crates
  // (#337). `cargo build --bin X` from anywhere in the workspace
  // resolves X transparently, so a check that only reads the
  // workspace-root manifest reports bins as missing even when they
  // exist in a member.
  for (const memberManifest of workspaceMemberManifests(cargoToml, cargoTomlPath)) {
    const memberParsed = readToml(memberManifest);
    if (memberParsed === null) {continue;}
    for (const b of collectBinsFromManifest(memberParsed)) {
      if (!result.includes(b)) {result.push(b);}
    }
  }
  return result;
}

function workspaceMemberManifests(
  cargoToml: Record<string, unknown>,
  cargoTomlPath: string,
): string[] {
  const workspace = cargoToml.workspace;
  if (typeof workspace !== 'object' || workspace === null) {return [];}
  const members = (workspace as { members?: unknown }).members;
  if (!Array.isArray(members)) {return [];}
  const workspaceDir = dirname(cargoTomlPath);
  const out: string[] = [];
  for (const m of members) {
    if (typeof m === 'string') {
      // `members` entries are globs (`packages/*`); expand them against
      // the filesystem the way cargo does so a member crate's [[bin]] is
      // found even when the workspace declares its members with a pattern.
      for (const memberDir of expandDirGlob(workspaceDir, m)) {
        out.push(join(memberDir, 'Cargo.toml'));
      }
    }
  }
  return out;
}

function collectBinsFromManifest(cargoToml: Record<string, unknown>): string[] {
  const result: string[] = [];
  const bins = cargoToml.bin;
  if (Array.isArray(bins)) {
    for (const entry of bins) {
      if (typeof entry === 'object' && entry !== null) {
        const name = (entry as { name?: unknown }).name;
        if (typeof name === 'string') {result.push(name);}
      }
    }
  }
  // Cargo's implicit-binary rule: a crate without any [[bin]] table
  // ships a binary named after `[package].name` when `src/main.rs`
  // exists. We can't observe the filesystem here without extra reads,
  // but treating the implicit name as a candidate avoids false
  // positives on the common single-bin shape.
  if (result.length === 0) {
    const pkg = cargoToml.package as { name?: unknown } | undefined;
    if (pkg && typeof pkg.name === 'string') {result.push(pkg.name);}
  }
  return result;
}

function versionInheritsWorkspace(version: unknown): boolean {
  return (
    typeof version === 'object' &&
    version !== null &&
    (version as { workspace?: unknown }).workspace === true
  );
}

function workspaceVersionDeclared(cargoTomlPath: string, cwd: string): boolean {
  // Walk parents until we find a Cargo.toml carrying a [workspace]
  // table; bound the walk at `cwd` so we never escape the repo.
  const cwdAbs = resolve(cwd);
  let cur = dirname(resolve(cargoTomlPath));
  // Step out of the package's own directory first — the package's own
  // Cargo.toml never declares its own workspace root.
  cur = dirname(cur);
  while (true) {
    const candidate = join(cur, 'Cargo.toml');
    const parsed = readToml(candidate);
    if (parsed !== null) {
      const workspace = (parsed.workspace ?? null) as Record<string, unknown> | null;
      if (workspace !== null) {
        const wsPkg = (workspace.package ?? {}) as Record<string, unknown>;
        return nonEmptyString(wsPkg.version);
      }
    }
    if (cur === cwdAbs || cur === dirname(cur)) {return false;}
    cur = dirname(cur);
  }
}

/* ----------------------- repository URL match ----------------------- */
//
// Catches the manifest-vs-GITHUB_REPOSITORY mismatch that npm's
// provenance verification rejects with a 422 ("repository.url is X,
// expected to match Y from provenance"). Same risk exists on
// crates.io / PyPI trusted-publisher paths against
// Cargo.toml [package].repository and pyproject.toml [project.urls];
// catching all three in the same check keeps the failure modes
// fingerprinted by the same error code.

export interface RepoUrlMatchOptions {
  /** Value of the GitHub Actions `GITHUB_REPOSITORY` env var, format
   *  `owner/repo`. When `undefined` or empty, the check is a no-op
   *  (local CLI runs outside a GHA context can't disagree with a
   *  workflow source). Accepts `undefined` explicitly so callers
   *  reading from `process.env.GITHUB_REPOSITORY` can pass the value
   *  through without a defensive ternary. */
  githubRepository?: string | undefined;
}

export interface RepoUrlMatchFinding {
  package: string;
  /** Pkg-relative manifest file the URL was read from. */
  manifestPath: string;
  /** The normalised `owner/repo` parsed from the manifest URL. */
  declaredOwnerRepo: string;
  /** The `owner/repo` from `GITHUB_REPOSITORY`. */
  expectedOwnerRepo: string;
  /** Verbatim URL as it appears in the manifest, useful for the
   *  remediation message. */
  declaredUrl: string;
}

// User-facing pointer for the manifest-repository-URL recipe. Surfaced
// verbatim in the thrown error so the consumer has a copy/paste fix
// instead of a code-search target.
const REPO_URL_DOC_POINTER =
  'https://thekevinscott.github.io/putitoutthere/guide/repository-url';

export function checkRepoUrlMatch(
  packages: readonly Package[],
  options: RepoUrlMatchOptions = {},
): RepoUrlMatchFinding[] {
  const expectedOwnerRepo = normalizeOwnerRepo(options.githubRepository);
  if (expectedOwnerRepo === null) {return [];}
  const findings: RepoUrlMatchFinding[] = [];
  for (const p of packages) {
    const declared = readDeclaredRepoUrl(p);
    if (declared === null) {continue;}
    const declaredOwnerRepo = parseOwnerRepo(declared.url);
    if (declaredOwnerRepo === null) {continue;}
    if (declaredOwnerRepo.toLowerCase() === expectedOwnerRepo.toLowerCase()) {continue;}
    findings.push({
      package: p.name,
      manifestPath: declared.manifestPath,
      declaredOwnerRepo,
      expectedOwnerRepo,
      declaredUrl: declared.url,
    });
  }
  return findings;
}

export function requireRepoUrlMatch(
  packages: readonly Package[],
  options: RepoUrlMatchOptions = {},
): void {
  const findings = checkRepoUrlMatch(packages, options);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    `[${ErrorCodes.REPO_URL_MISMATCH}] manifest repository URL does not match GITHUB_REPOSITORY.`,
    '',
    'Failing packages:',
  ];
  for (const f of findings) {
    lines.push(
      `  - ${f.package}: ${f.manifestPath}`,
      `      declared:  ${f.declaredOwnerRepo}  (${f.declaredUrl})`,
      `      expected:  ${f.expectedOwnerRepo}  (from GITHUB_REPOSITORY)`,
    );
  }
  lines.push(
    '',
    'Why: npm verifies `package.json#repository.url` against the OIDC source claim',
    'before accepting a `--provenance` publish and rejects mismatches with a 422',
    'after the artifact has already been uploaded. crates.io and PyPI carry the same',
    'risk on their trusted-publisher paths.',
    '',
    'Fix: either update the manifest URL to match the GitHub repository this workflow',
    'is running from, or rename the GitHub repository so the slugs line up. Run the',
    'release again once the manifest and the repo agree.',
    '',
    `See ${REPO_URL_DOC_POINTER}.`,
  );
  throw new Error(lines.join('\n'));
}

interface DeclaredRepoUrl {
  url: string;
  manifestPath: string;
}

function readDeclaredRepoUrl(p: Package): DeclaredRepoUrl | null {
  switch (p.kind) {
    case 'npm': {
      const manifestPath = join(p.path, 'package.json');
      const parsed = readJson(manifestPath);
      if (parsed === null) {return null;}
      const repository = (parsed as { repository?: unknown }).repository;
      if (typeof repository === 'string' && repository.trim().length > 0) {
        return { url: repository.trim(), manifestPath };
      }
      if (repository !== null && typeof repository === 'object') {
        const url = (repository as { url?: unknown }).url;
        if (typeof url === 'string' && url.trim().length > 0) {
          return { url: url.trim(), manifestPath };
        }
      }
      return null;
    }
    case 'crates': {
      const manifestPath = join(p.path, 'Cargo.toml');
      const parsed = readTomlDoc(manifestPath);
      if (parsed === null) {return null;}
      const pkgTable = (parsed.package ?? {}) as Record<string, unknown>;
      const repo = pkgTable.repository;
      if (typeof repo === 'string' && repo.trim().length > 0) {
        return { url: repo.trim(), manifestPath };
      }
      return null;
    }
    case 'pypi': {
      const manifestPath = join(p.path, 'pyproject.toml');
      const parsed = readTomlDoc(manifestPath);
      if (parsed === null) {return null;}
      const project = (parsed.project ?? {}) as Record<string, unknown>;
      const urls = (project.urls ?? {}) as Record<string, unknown>;
      // PEP 621 leaves the key casing to the project, and PyPI normalises
      // common labels case-insensitively. Accept the canonical "Repository"
      // first and fall back to common synonyms (source-code repos vs.
      // homepage links) so a project picking any reasonable label still
      // gets the check.
      for (const key of ['Repository', 'repository', 'Source', 'source', 'Homepage', 'homepage']) {
        const candidate = urls[key];
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return { url: candidate.trim(), manifestPath };
        }
      }
      return null;
    }
  }
}

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readTomlDoc(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseToml(raw);
  } catch {
    return null;
  }
}

function normalizeOwnerRepo(value: string | undefined): string | null {
  if (value === undefined) {return null;}
  const trimmed = value.trim();
  if (trimmed.length === 0) {return null;}
  // Tolerate accidental wrapping (e.g. `https://github.com/owner/repo`
  // landed in the GITHUB_REPOSITORY env var by misconfiguration); the
  // GHA-provided value is always `owner/repo` so this is defence in
  // depth, not a documented surface.
  const slugMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (slugMatch) {
    return `${slugMatch[1]}/${slugMatch[2]}`;
  }
  return parseOwnerRepo(trimmed);
}

// Recognises the canonical GitHub URL shapes the npm / cargo / hatch
// ecosystems serialise into manifests:
//   - git+https://github.com/owner/repo(.git)?
//   - https://github.com/owner/repo(.git)?(/)?
//   - http://github.com/owner/repo(.git)?(/)?
//   - git@github.com:owner/repo(.git)?
//   - ssh://git@github.com/owner/repo(.git)?
// Non-github hosts return null; the check skips those packages rather
// than false-positive on legitimately-hosted forks (provenance still
// catches them at publish time).
function parseOwnerRepo(url: string): string | null {
  const stripped = url.trim().replace(/^git\+/i, '');
  const match = stripped.match(
    /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  );
  if (match === null) {return null;}
  return `${match[1]}/${match[2]}`;
}

/* ----------------------- repository visibility ----------------------- */
//
// Hard-fails when the GitHub repository running the workflow is
// private. npm provenance attestations embed a public source-ref
// pointer; a private repo means consumers cannot verify the
// attestation, and the same source-visibility expectation underpins
// the trusted-publisher story on every registry we publish to.

export interface RepoVisibilityOptions {
  /** `owner/repo` from `GITHUB_REPOSITORY`. When `undefined` or empty
   *  the check is a no-op. */
  githubRepository?: string | undefined;
  /** Token used to authenticate the GitHub API call. Optional — the
   *  visibility endpoint is reachable unauthenticated for public
   *  repos, and a missing token plus a 404 disambiguates to
   *  "private or non-existent" which the check reports either way. */
  githubToken?: string | undefined;
  /** Injection seam for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface RepoVisibilityFinding {
  /** The `owner/repo` whose visibility check failed. */
  githubRepository: string;
  /** Either the API said `private: true`, or the API replied with a
   *  404 (which for our purposes is indistinguishable from private —
   *  in both cases consumers cannot dereference a provenance source
   *  pointer to inspect it). */
  reason: 'private' | 'not-found-or-private';
}

const REPO_VISIBILITY_DOC_POINTER =
  'https://thekevinscott.github.io/putitoutthere/guide/public-repo';

export async function checkRepoPublic(
  options: RepoVisibilityOptions = {},
): Promise<RepoVisibilityFinding | null> {
  const githubRepository = options.githubRepository?.trim();
  if (githubRepository === undefined || githubRepository.length === 0) {
    return null;
  }
  // Fall back to the raw value if normalization fails; the API call
  // will 404 and the check will report `not-found-or-private`, which
  // is the right diagnosis for a malformed slug we can't disambiguate.
  const apiSlug = normalizeOwnerRepo(githubRepository) ?? githubRepository;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'putitoutthere',
  };
  if (options.githubToken !== undefined && options.githubToken.length > 0) {
    headers.authorization = `Bearer ${options.githubToken}`;
  }
  const url = `https://api.github.com/repos/${apiSlug}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers });
  } catch (err) {
    // A network failure says nothing about repository visibility.
    // Treat it as indeterminate rather than blocking the release.
    warnIndeterminate(apiSlug, `request failed (${(err as Error).message})`);
    return null;
  }
  if (res.status === 404) {
    return { githubRepository: apiSlug, reason: 'not-found-or-private' };
  }
  if (res.status === 200) {
    const body = (await res.json()) as { private?: unknown; visibility?: unknown };
    const isPrivate =
      body.private === true ||
      (typeof body.visibility === 'string' && body.visibility !== 'public');
    if (isPrivate) {
      return { githubRepository: apiSlug, reason: 'private' };
    }
    return null;
  }
  // Any other status (most commonly a 403 from an unauthenticated
  // rate-limited call, or a transient 5xx) tells us nothing about
  // visibility. Blocking the publish on "we couldn't reach the API"
  // is the kind of release surprise this engine exists to prevent —
  // treat it as indeterminate and non-fatal, with a visible warning.
  warnIndeterminate(apiSlug, `GitHub API returned ${res.status}`);
  return null;
}

function warnIndeterminate(apiSlug: string, detail: string): void {
  process.stdout.write(
    `::warning::repository visibility check skipped for ${apiSlug}: ${detail}\n`,
  );
}

export async function requireRepoPublic(
  options: RepoVisibilityOptions = {},
): Promise<void> {
  const finding = await checkRepoPublic(options);
  if (finding === null) {return;}
  const lines: string[] = [
    `[${ErrorCodes.REPO_PRIVATE}] refusing to publish from a private GitHub repository (${finding.githubRepository}).`,
    '',
    finding.reason === 'private'
      ? 'The GitHub API reports this repository as private.'
      : 'The GitHub API returned 404 for this repository slug — either the repo is private and the configured token lacks access, or the slug does not exist.',
    '',
    'Why: npm provenance attestations embed a public source-ref pointer that',
    'consumers cannot dereference on a private repo, and the same source-visibility',
    'expectation underpins the trusted-publisher story across the registries we',
    'publish to. Publishing from a private repo silently degrades every consumer\'s',
    'ability to verify the artifact.',
    '',
    'Fix: make the repository public before publishing, or unset the release',
    'trigger until visibility flips. See',
    `  ${REPO_VISIBILITY_DOC_POINTER}`,
    'for the trusted-publisher rationale and the registry-specific failure modes',
    'this check exists to prevent.',
  ];
  throw new Error(lines.join('\n'));
}

export function requireCargoShape(
  packages: readonly Package[],
  options: CargoShapeOptions = {},
): void {
  const findings = checkCargoShape(packages, options);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    'Pre-flight Cargo.toml shape check failed:',
    '',
  ];
  for (const f of findings) {
    lines.push(`  [${f.code}] ${f.package}: ${f.cargoTomlPath}`);
    lines.push(`    ${f.detail}`);
  }
  lines.push(
    '',
    'Why: these mismatches would otherwise surface mid-`cargo build` or mid-`cargo',
    'publish` after the verification build has compiled the crate and every transitive',
    'dep — wasting the publish job on a precondition checkable in milliseconds.',
    'Fix the Cargo.toml + putitoutthere.toml fields in this list, then re-run.',
  );
  throw new Error(lines.join('\n'));
}

/* ----------------------- package.json shape (npm) ----------------------- */
//
// npm parity with the pyproject / Cargo name-shape gates above (#301).
// `npm publish` packs the `name` from package.json, but the engine's
// idempotency probe (`npm view <name>` in src/handlers/npm.ts) and the
// tag/URL bookkeeping use the configured `[[package]].name` (or the `npm`
// override). A divergence silently breaks idempotency and can publish
// under an unexpected name — the npm analogue of PIOT_PYPI_NAME_MISMATCH /
// PIOT_CRATES_NAME_MISMATCH.

export type NpmShapeCode = 'PIOT_NPM_NAME_MISMATCH';

export interface PackageJsonShapeFinding {
  package: string;
  packageJsonPath: string;
  code: NpmShapeCode;
  detail: string;
}

export function checkPackageJsonShape(
  packages: readonly Package[],
): PackageJsonShapeFinding[] {
  const findings: PackageJsonShapeFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'npm') {continue;}
    const packageJsonPath = join(p.path, 'package.json');
    let raw: string;
    try {
      raw = readFileSync(packageJsonPath, 'utf8');
    } catch {
      // Missing package.json is a different failure surface:
      // `checkProvenanceMetadata` reports it, and `check.ts` surfaces it
      // at PR time. Skip.
      continue;
    }
    let parsed: { name?: unknown };
    try {
      parsed = JSON.parse(raw) as { name?: unknown };
    } catch {
      // Malformed package.json — let the publish step surface its own
      // diagnostic. This check only owns the `name` field.
      continue;
    }
    const expectedName = p.npm ?? p.name;
    if (typeof parsed.name === 'string' && parsed.name !== expectedName) {
      findings.push({
        package: p.name,
        packageJsonPath,
        code: 'PIOT_NPM_NAME_MISMATCH',
        detail: `name = "${parsed.name}" but configured name is "${expectedName}"`,
      });
    }
  }
  return findings;
}

export function requirePackageJsonShape(packages: readonly Package[]): void {
  const findings = checkPackageJsonShape(packages);
  if (findings.length === 0) {return;}
  const lines: string[] = [
    'Pre-flight package.json shape check failed:',
    '',
  ];
  for (const f of findings) {
    lines.push(`  [${f.code}] ${f.package}: ${f.packageJsonPath}`);
    lines.push(`    ${f.detail}`);
  }
  lines.push(
    '',
    'Why: `npm publish` packs the `name` from package.json, but the engine\'s',
    'idempotency probe (`npm view <name>`) and the tag/URL bookkeeping use the',
    'configured [[package]].name (or the `npm` override) — a divergence breaks',
    'idempotency and can publish under an unexpected name.',
    'Fix the package.json `name` or set the `npm` override in putitoutthere.toml, then re-run.',
  );
  throw new Error(lines.join('\n'));
}
