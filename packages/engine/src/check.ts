/**
 * `putitoutthere check` — pre-merge configuration validation.
 *
 * Implements the "No release surprises" goal from
 * `notes/design-commitments.md`: every check knowable from the
 * consumer's repo state alone runs at PR time, before a release run
 * could fail mid-publish on a precondition checkable in milliseconds.
 *
 * Each check function (one per module under `check/`) returns
 * findings; the top-level `runChecks` aggregates them so the consumer
 * fixes everything in one round-trip rather than chasing one error at
 * a time across re-runs. `require-` style throwing helpers live in
 * `preflight.ts` for the publish path; this entry point is read-only
 * diagnostic.
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

import { isAbsolute, join, resolve } from 'node:path';

import { checkCratesPackageSize } from './check-crate-size.js';
import { checkCargoShapeFindings } from './check/check-cargo-shape-findings.js';
import { checkCratesPackageMetadata } from './check/check-crates-package-metadata.js';
import { checkDependsOn } from './check/check-depends-on.js';
import { checkGlobsMatchTrackedFiles } from './check/check-globs-match-tracked-files.js';
import { checkNpmRepository } from './check/check-npm-repository.js';
import { checkNpmTargetTriples } from './check/check-npm-target-triples.js';
import { checkPackageJsonShapeFindings } from './check/check-package-json-shape-findings.js';
import { checkPaths } from './check/check-paths.js';
import { checkPypiVersion } from './check/check-pypi-version.js';
import { checkPyprojectAndBundleCli } from './check/check-pyproject-and-bundle-cli.js';
import { checkPyprojectShapeFindings } from './check/check-pyproject-shape-findings.js';
import { checkRepoUrlMatchFindings } from './check/check-repo-url-match-findings.js';
import { checkTagTemplateCollisions } from './check/check-tag-template-collisions.js';
import { loadConfig, type Package } from './config.js';
import { toError } from './to-error.js';
import { pathExists } from './utils/path-exists.js';

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
