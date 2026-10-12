/**
 * Pre-flight checks, run before any publish side effect (#14, #280; plan §16.3).
 * Auth: each handler accepts OIDC (detected via `ACTIONS_ID_TOKEN_REQUEST_TOKEN`)
 * or a specific long-lived env var. `npm publish --provenance` hard-requires a
 * non-empty `package.json#repository`. `require*` throws; `check*` reports.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { checkPackageJsonShape } from './check-package-json-shape.js';
import { collectBundleCliCrateFindings } from './collect-bundle-cli-crate-findings.js';
import { collectCratesPackageFindings } from './collect-crates-package-findings.js';
import type { Package } from './config.js';
import { expandDirGlob } from './glob.js';
import { normalizeOwnerRepo } from './normalize-owner-repo.js';
import { parseOwnerRepo } from './parse-owner-repo.js';
import { classifyPypiVersionSource } from './pypi-version-source.js';
import { readDeclaredRepoUrl } from './read-declared-repo-url.js';
import { readToml } from './read-toml.js';
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

/* ----------------------- crates.io required metadata ----------------------- */

export function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Return the inherited workspace value when the field is declared as
 * `<field>.workspace = true`; otherwise pass the raw value through.
 * `wsPkgTable` is `undefined` when no parent `Cargo.toml` declares a
 * `[workspace.package]` block — inheritance simply yields `undefined`
 * there, which `nonEmptyString` correctly treats as missing.
 */
export function resolveInherited(
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
  | 'PIOT_PYPI_HATCH_VERSION_PATH'
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

export async function checkPyprojectShape(
  packages: readonly Package[],
): Promise<PyprojectShapeFinding[]> {
  const findings: PyprojectShapeFinding[] = [];
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    let raw: string;
    try {
      raw = await readFile(pyprojectPath, 'utf8');
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

    // PYPI_DYNAMIC_VERSION_NO_BACKEND / PYPI_HATCH_VERSION_PATH — only
    // checks setuptools / hatch. Maturin sources its version from
    // Cargo.toml's [package].version when `dynamic = ["version"]` (and
    // `write-version` does bump that), so classifying its pyproject
    // would surface false positives on every maturin pypi package.
    //
    // The declared source has to be *reachable*, not merely present: a
    // version table whose plugin is missing from
    // `[build-system].requires`, or one that reads a literal off a file
    // nothing rewrites, both ship the previous release's version. The
    // decision lives in `classifyPypiVersionSource` (#696).
    if (p.build !== 'maturin') {
      const dynamic = project.dynamic;
      const dynamicHasVersion =
        Array.isArray(dynamic) && dynamic.some((v) => v === 'version');
      if (dynamicHasVersion) {
        const verdict = classifyPypiVersionSource(buildSystem, tool);
        if (!verdict.reachable) {
          findings.push({
            package: p.name,
            pyprojectPath,
            code: verdict.code,
            detail: verdict.detail,
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

export async function requirePyprojectShape(packages: readonly Package[]): Promise<void> {
  const findings = await checkPyprojectShape(packages);
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

export async function checkCargoShape(
  packages: readonly Package[],
  options: CargoShapeOptions = {},
): Promise<CargoShapeFinding[]> {
  const findings: CargoShapeFinding[] = [];
  const cwd = options.cwd ?? process.cwd();
  for (const p of packages) {
    if (p.kind === 'crates') {
      await collectCratesPackageFindings(p, cwd, findings);
    } else if (p.kind === 'pypi' && p.bundle_cli !== undefined) {
      await collectBundleCliCrateFindings(p, p.bundle_cli, cwd, findings);
    }
  }
  return findings;
}

export function declaredFeatures(cargoToml: Record<string, unknown>): Set<string> {
  const features = (cargoToml.features ?? {}) as Record<string, unknown>;
  return new Set(Object.keys(features));
}

export async function readDeclaredBinNames(
  cargoToml: Record<string, unknown>,
  cargoTomlPath: string,
): Promise<string[]> {
  const result = collectBinsFromManifest(cargoToml);
  // Workspace manifests delegate [[bin]] declarations to member crates
  // (#337). `cargo build --bin X` from anywhere in the workspace
  // resolves X transparently, so a check that only reads the
  // workspace-root manifest reports bins as missing even when they
  // exist in a member.
  for (const memberManifest of await workspaceMemberManifests(cargoToml, cargoTomlPath)) {
    const memberParsed = await readToml(memberManifest);
    if (memberParsed === null) {continue;}
    for (const b of collectBinsFromManifest(memberParsed)) {
      if (!result.includes(b)) {result.push(b);}
    }
  }
  return result;
}

async function workspaceMemberManifests(
  cargoToml: Record<string, unknown>,
  cargoTomlPath: string,
): Promise<string[]> {
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
      for (const memberDir of await expandDirGlob(workspaceDir, m)) {
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

export function versionInheritsWorkspace(version: unknown): boolean {
  return (
    typeof version === 'object' &&
    version !== null &&
    (version as { workspace?: unknown }).workspace === true
  );
}

export async function workspaceVersionDeclared(cargoTomlPath: string, cwd: string): Promise<boolean> {
  // Walk parents until we find a Cargo.toml carrying a [workspace]
  // table; bound the walk at `cwd` so we never escape the repo.
  const cwdAbs = resolve(cwd);
  let cur = dirname(resolve(cargoTomlPath));
  // Step out of the package's own directory first — the package's own
  // Cargo.toml never declares its own workspace root.
  cur = dirname(cur);
  while (true) {
    const candidate = join(cur, 'Cargo.toml');
    const parsed = await readToml(candidate);
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

export async function checkRepoUrlMatch(
  packages: readonly Package[],
  options: RepoUrlMatchOptions = {},
): Promise<RepoUrlMatchFinding[]> {
  const expectedOwnerRepo = normalizeOwnerRepo(options.githubRepository);
  if (expectedOwnerRepo === null) {return [];}
  const findings: RepoUrlMatchFinding[] = [];
  for (const p of packages) {
    const declared = await readDeclaredRepoUrl(p);
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

export async function requireCargoShape(
  packages: readonly Package[],
  options: CargoShapeOptions = {},
): Promise<void> {
  const findings = await checkCargoShape(packages, options);
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

export async function requirePackageJsonShape(packages: readonly Package[]): Promise<void> {
  const findings = await checkPackageJsonShape(packages);
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
