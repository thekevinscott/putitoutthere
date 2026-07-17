/**
 * `putitoutthere check` — pre-merge configuration validation.
 *
 * Implements the "No release surprises" goal from
 * `notes/design-commitments.md`: every check knowable from the
 * consumer's repo state alone runs at PR time, before a release run
 * could fail mid-publish on a precondition checkable in milliseconds.
 *
 * Each check function returns findings; the top-level `runChecks`
 * aggregates them so the consumer fixes everything in one round-trip
 * rather than chasing one error at a time across re-runs. `require-`
 * style throwing helpers live in `preflight.ts` for the publish path;
 * this file is read-only diagnostic.
 *
 * Non-goal #8 (parallel diagnostic surfaces): every check here either
 * already runs at publish time via `preflight.ts` / `plan.ts` /
 * `cascade.ts`, or — for the genuinely-new checks (path exists, globs
 * match a tracked file, tag-template collisions, pyproject.toml +
 * bundle_cli) — is a thin pre-pass of state the publish path already
 * relies on. No parallel diagnostic code path; the engine entry point
 * is shared with the publish phase.
 *
 * Issue #319.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { assertNoCycles } from './cascade.js';
import { checkCratesPackageSize } from './check-crate-size.js';
import { loadConfig, type Package } from './config.js';
import { ErrorCodes } from './error-codes.js';
import { expandDirGlob, matchesAny } from './glob.js';
import { execCapture } from './utils/exec-capture.js';
import { pathExists } from './utils/path-exists.js';
import { assertTripleSupported } from './handlers/npm-platform.js';
import {
  checkCargoShape,
  checkCratesMetadata,
  checkPackageJsonShape,
  checkProvenanceMetadata,
  checkPyprojectShape,
  checkPypiVersionSource,
  checkRepoUrlMatch,
} from './preflight.js';
import { formatTag } from './tag-template.js';
import { toError } from './to-error.js';
import { normalizeTarget, type TargetEntry } from './types.js';

export interface CheckFinding {
  /** The `[[package]].name` the finding is scoped to. Absent for
   *  file-level findings (missing config, root-level parse errors). */
  package?: string;
  /** Single-line, actionable message: failing artefact path or
   *  field, why it matters, what to change. */
  message: string;
}

export interface CheckOptions {
  cwd: string;
  /** Override for tests. Defaults to `${cwd}/putitoutthere.toml`. */
  configPath?: string;
}

/**
 * Run every check that's knowable from the consumer's repo state
 * alone. Returns an aggregated finding list; an empty list means a
 * release run from this commit would not surface configuration-level
 * surprises.
 *
 * Short-circuits when the config can't be loaded — every downstream
 * check assumes a parsed `Config`, and a missing or malformed file
 * would otherwise cascade into a noisy stack trace per package.
 */
export async function runChecks(opts: CheckOptions): Promise<CheckFinding[]> {
  const findings: CheckFinding[] = [];
  const cwd = opts.cwd;
  const cfgPath = opts.configPath ?? join(cwd, 'putitoutthere.toml');

  if (!(await pathExists(cfgPath))) {
    findings.push({
      message: `putitoutthere.toml not found at ${cfgPath}. Drop one at the repo root; see https://github.com/thekevinscott/putitoutthere#2-drop-in-putitoutthere-toml`,
    });
    return findings;
  }

  let packages: Package[];
  try {
    const config = await loadConfig(cfgPath);
    // Anchor pkg.path to opts.cwd up front so per-kind fs ops point at
    // the right tree even when the CLI is invoked with --cwd from
    // outside the repo (mirrors publish.ts's loop).
    packages = config.packages.map((p) => ({
      ...p,
      path: isAbsolute(p.path) ? p.path : resolve(cwd, p.path),
    }));
  } catch (err) {
    findings.push({
      message: toError(err).message,
    });
    return findings;
  }

  await checkPaths(packages, findings);
  await checkGlobsMatchTrackedFiles(packages, cwd, findings);
  checkDependsOn(packages, findings);
  checkTagTemplateCollisions(packages, findings);
  await checkNpmRepository(packages, findings);
  await checkCratesPackageMetadata(packages, findings);
  findings.push(...(await checkCratesPackageSize(packages)));
  await checkPyprojectAndBundleCli(packages, cwd, findings);
  await checkPypiVersion(packages, findings);
  await checkPyprojectShapeFindings(packages, findings);
  await checkCargoShapeFindings(packages, cwd, findings);
  await checkPackageJsonShapeFindings(packages, findings);
  checkNpmTargetTriples(packages, findings);
  await checkRepoUrlMatchFindings(packages, findings);

  return findings;
}

async function checkRepoUrlMatchFindings(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  // Sourced from GHA's process env at PR time when this runs inside the
  // reusable workflow. Locally invoked `putitoutthere check` outside any
  // GHA context will skip the check (the preflight returns no findings
  // when GITHUB_REPOSITORY is unset), which is the right behaviour:
  // there is no workflow source to disagree with.
  const githubRepository = process.env.GITHUB_REPOSITORY;
  for (const f of await checkRepoUrlMatch(packages, { githubRepository })) {
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.REPO_URL_MISMATCH}] ${f.manifestPath}: declared repository "${f.declaredOwnerRepo}" does not match GITHUB_REPOSITORY "${f.expectedOwnerRepo}". npm rejects \`--provenance\` publishes whose package.json#repository.url disagrees with the OIDC source claim (422); crates.io / PyPI trusted-publisher paths carry the same risk.`,
    });
  }
}

async function checkPyprojectShapeFindings(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkPyprojectShape(packages)) {
    findings.push({
      package: f.package,
      message: `[${f.code}] ${f.pyprojectPath}: ${f.detail}`,
    });
  }
}

async function checkCargoShapeFindings(
  packages: readonly Package[],
  cwd: string,
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkCargoShape(packages, { cwd })) {
    findings.push({
      package: f.package,
      message: `[${f.code}] ${f.cargoTomlPath}: ${f.detail}`,
    });
  }
}

async function checkPackageJsonShapeFindings(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkPackageJsonShape(packages)) {
    findings.push({
      package: f.package,
      message: `[${f.code}] ${f.packageJsonPath}: ${f.detail}`,
    });
  }
}

/* ----------------------------- internals ----------------------------- */

async function checkPaths(packages: readonly Package[], findings: CheckFinding[]): Promise<void> {
  for (const p of packages) {
    if (!(await pathExists(p.path)) || !(await stat(p.path)).isDirectory()) {
      findings.push({
        package: p.name,
        message: `path "${p.path}" does not exist or is not a directory in the worktree`,
      });
    }
  }
}

async function checkGlobsMatchTrackedFiles(
  packages: readonly Package[],
  cwd: string,
  findings: CheckFinding[],
): Promise<void> {
  const tracked = await listTrackedFiles(cwd);
  /* v8 ignore start -- checks run inside the repo checkout where git ls-files always resolves; the null branch is defensive against callers outside a worktree */
  if (tracked === null) {return;}
  /* v8 ignore stop -- end of defensive guard above */
  for (const p of packages) {
    const matched = tracked.some((f) => matchesAny(p.globs, f));
    if (!matched) {
      findings.push({
        package: p.name,
        message: `globs ${JSON.stringify(p.globs)} matched no tracked files. Empty globs mean the package will never cascade on a real commit.`,
      });
    }
  }
}

function checkDependsOn(packages: readonly Package[], findings: CheckFinding[]): void {
  try {
    assertNoCycles(packages);
  } catch (err) {
    findings.push({
      message: toError(err).message,
    });
  }
}

function checkTagTemplateCollisions(
  packages: readonly Package[],
  findings: CheckFinding[],
): void {
  // Templates collide when they resolve to the same tag at the same
  // version — typically when `{name}` is omitted and every package
  // thereafter races for one tag slot. A sentinel version is enough:
  // differing templates differ on every version, identical templates
  // collide on every version.
  const seen = new Map<string, string>();
  for (const p of packages) {
    const sentinel = formatTag(p.tag_format, { name: p.name, version: '0.0.0' });
    const prior = seen.get(sentinel);
    if (prior !== undefined) {
      findings.push({
        message: `tag_format collision: "${p.name}" and "${prior}" both resolve to tag "${sentinel}" at the same version. Include {name} in tag_format to disambiguate.`,
      });
    } else {
      seen.set(sentinel, p.name);
    }
  }
}

async function checkNpmRepository(packages: readonly Package[], findings: CheckFinding[]): Promise<void> {
  for (const f of await checkProvenanceMetadata(packages)) {
    const reason =
      f.reason === 'missing'
        ? `${f.packageJsonPath} not found`
        : `${f.packageJsonPath} has missing or empty \`repository\``;
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.NPM_MISSING_REPOSITORY}] ${reason}. \`npm publish --provenance\` hard-requires a non-empty repository.url.`,
    });
  }
}

async function checkCratesPackageMetadata(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkCratesMetadata(packages)) {
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.CRATES_MISSING_METADATA}] ${f.cargoTomlPath} missing required Cargo.toml [package] field(s): ${f.missing.join(', ')}. crates.io rejects the publish after cargo's verification build.`,
    });
  }
}

async function checkPyprojectAndBundleCli(
  packages: readonly Package[],
  cwd: string,
  findings: CheckFinding[],
): Promise<void> {
  for (const p of packages) {
    if (p.kind !== 'pypi') {continue;}
    const pyprojectPath = join(p.path, 'pyproject.toml');
    if (!(await pathExists(pyprojectPath))) {
      findings.push({
        package: p.name,
        message: `pyproject.toml not found at ${pyprojectPath}`,
      });
      continue;
    }
    if (p.build !== 'maturin' || p.bundle_cli === undefined) {continue;}
    const bundleCli = p.bundle_cli;
    // `bundle_cli.crate_path` is documented as relative to the repo
    // root (see config.ts: default = "."). Resolve against `cwd`,
    // not the package path.
    const cratePathAbs = isAbsolute(bundleCli.crate_path)
      ? bundleCli.crate_path
      : resolve(cwd, bundleCli.crate_path);
    const cargoTomlPath = join(cratePathAbs, 'Cargo.toml');
    if (!(await pathExists(cratePathAbs)) || !(await stat(cratePathAbs)).isDirectory()) {
      findings.push({
        package: p.name,
        message: `bundle_cli.crate_path "${bundleCli.crate_path}" does not exist or is not a directory`,
      });
      continue;
    }
    if (!(await pathExists(cargoTomlPath))) {
      findings.push({
        package: p.name,
        message: `bundle_cli.crate_path "${bundleCli.crate_path}" has no Cargo.toml`,
      });
      continue;
    }
    const declaredBins = await readDeclaredBins(cargoTomlPath);
    if (!declaredBins.includes(bundleCli.bin)) {
      findings.push({
        package: p.name,
        message: `bundle_cli.bin "${bundleCli.bin}" is not declared as a [[bin]] in ${cargoTomlPath}. Declared bins: ${declaredBins.length === 0 ? '(none)' : declaredBins.join(', ')}.`,
      });
    }
  }
}

async function checkPypiVersion(
  packages: readonly Package[],
  findings: CheckFinding[],
): Promise<void> {
  for (const f of await checkPypiVersionSource(packages)) {
    findings.push({
      package: f.package,
      message: `[${ErrorCodes.PYPI_STATIC_VERSION}] ${f.pyprojectPath} declares a static \`[project].version\` literal. Use \`[project].dynamic = ["version"]\` with hatch-vcs (recommended), setuptools-scm, or the maturin Cargo.toml-driven path — putitoutthere does not edit pyproject.toml at release time, so a literal silently ships the previous release.`,
    });
  }
}

function checkNpmTargetTriples(
  packages: readonly Package[],
  findings: CheckFinding[],
): void {
  for (const p of packages) {
    if (p.kind !== 'npm') {continue;}
    const targets = (p as { targets?: TargetEntry[] }).targets;
    if (!targets) {continue;}
    for (const t of targets) {
      const { triple } = normalizeTarget(t);
      try {
        assertTripleSupported(triple, p.name);
      } catch (err) {
        findings.push({
          package: p.name,
          message: toError(err).message,
        });
      }
    }
  }
}

async function listTrackedFiles(cwd: string): Promise<string[] | null> {
  try {
    const { stdout } = await execCapture('git', ['ls-files'], { cwd });
    return stdout.split('\n').filter((l) => l.length > 0);
  } catch {
    return null;
  }
}

async function readDeclaredBins(cargoTomlPath: string): Promise<string[]> {
  const parsed = await parseCargoToml(cargoTomlPath);
  if (parsed === null) {return [];}
  const result = collectBinsFromManifest(parsed);
  // Workspace manifests delegate [[bin]] declarations to member crates
  // (#337). `cargo build --bin X` from anywhere in the workspace
  // resolves X transparently, so a check that only reads the
  // workspace-root manifest reports bins as missing even when they
  // exist in a member. Walk `[workspace].members` so `crate_path = "."`
  // (the default) satisfies the standard cargo-workspace shape.
  // `members` entries are globs, expanded against the filesystem the way
  // cargo resolves them. parseCargoToml returns null for missing /
  // malformed manifests, so stray entries silently drop out — cargo's
  // own diagnostics own surfacing those.
  for (const memberManifest of await workspaceMemberManifests(parsed, cargoTomlPath)) {
    const memberParsed = await parseCargoToml(memberManifest);
    if (memberParsed === null) {continue;}
    for (const b of collectBinsFromManifest(memberParsed)) {
      if (!result.includes(b)) {result.push(b);}
    }
  }
  return result;
}

async function workspaceMemberManifests(
  parsed: Record<string, unknown>,
  cargoTomlPath: string,
): Promise<string[]> {
  const workspace = parsed.workspace;
  if (typeof workspace !== 'object' || workspace === null) {return [];}
  const members = (workspace as { members?: unknown }).members;
  if (!Array.isArray(members)) {return [];}
  const workspaceDir = dirname(cargoTomlPath);
  const out: string[] = [];
  for (const m of members) {
    if (typeof m === 'string') {
      for (const memberDir of await expandDirGlob(workspaceDir, m)) {
        out.push(join(memberDir, 'Cargo.toml'));
      }
    }
  }
  return out;
}

async function parseCargoToml(path: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseToml(raw);
  } catch {
    return null;
  }
}

function collectBinsFromManifest(parsed: Record<string, unknown>): string[] {
  const result: string[] = [];
  const bins = parsed.bin;
  if (Array.isArray(bins)) {
    for (const entry of bins) {
      if (typeof entry === 'object' && entry !== null) {
        const name = (entry as { name?: unknown }).name;
        if (typeof name === 'string') {result.push(name);}
      }
    }
  }
  // Cargo's implicit-binary rule: a crate without any explicit [[bin]]
  // table ships a binary named after `[package].name` when
  // `src/main.rs` exists. Include that name as a candidate so the
  // common single-binary shape (one crate, one bin, no [[bin]] block)
  // doesn't spuriously fail this check.
  if (result.length === 0) {
    const pkg = parsed.package as { name?: unknown } | undefined;
    if (pkg && typeof pkg.name === 'string') {result.push(pkg.name);}
  }
  return result;
}
