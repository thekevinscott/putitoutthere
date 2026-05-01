/**
 * Pre-build version bump used by `_matrix.yml`'s maturin steps. #276.
 *
 * Maturin reads `[project].version` from `pyproject.toml` (or
 * `[package].version` from a sibling `Cargo.toml` when pyproject
 * declares `dynamic = ["version"]`) at build time. There is no env
 * override the build job can inject — `SETUPTOOLS_SCM_PRETEND_VERSION`
 * is honored by hatch-vcs / setuptools-scm but not by maturin. So
 * the on-disk manifest has to be rewritten before `maturin build`
 * runs. crates and npm bump at publish (cargo / npm read the
 * manifest at upload time, not before); maturin is the one path
 * where the artifact (the wheel) leaves the build runner already
 * versioned.
 *
 * This module is the build-time complement to `pypi.writeVersion`.
 * The publish-time handler logs guidance for dynamic-version
 * projects rather than rewriting Cargo.toml; here we actually do
 * the rewrite, because the build step has no fallback.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { replaceCargoVersion } from './handlers/crates.js';
import { replacePyProjectVersion } from './handlers/pypi.js';

/**
 * Rewrite the version source for a maturin package and return the
 * absolute path to the file that was modified.
 *
 * Dispatch:
 *  - `[project].version = "..."` is a static literal → rewrite
 *    pyproject.toml in place.
 *  - `[project].dynamic = ["version", ...]` → rewrite the sibling
 *    `Cargo.toml`'s `[package].version`. Errors if Cargo.toml is
 *    missing.
 *
 * Throws on missing pyproject.toml, malformed TOML, or a `[project]`
 * table that declares neither a literal nor `dynamic = ["version"]`.
 *
 * I/O uses `readFileSync` with `try` / `catch (ENOENT)` instead of an
 * `existsSync` precheck — the precheck is a TOCTOU race CodeQL flags
 * (`pull/277` advisories #13, #14), and `pypi.writeVersion` already
 * uses the same try/catch shape we mirror here.
 */
export function writeVersionForBuild(pkgDir: string, version: string): string {
  const pyProjectPath = join(pkgDir, 'pyproject.toml');
  let pyOriginal: string;
  try {
    pyOriginal = readFileSync(pyProjectPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`write-version: pyproject.toml not found at ${pyProjectPath}`, {
        cause: err,
      });
    }
    /* v8 ignore next -- non-ENOENT read errors surface as-is */
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = parseToml(pyOriginal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`write-version: failed to parse ${pyProjectPath}: ${msg}`, { cause: err });
  }
  const project = (parsed as { project?: { dynamic?: unknown } })?.project;
  if (!project) {
    throw new Error(
      `write-version: ${pyProjectPath} has no [project] table -- declare [project].version or [project].dynamic = ["version"]`,
    );
  }

  if (isDynamicVersion(project)) {
    const cargoPath = join(pkgDir, 'Cargo.toml');
    let cargoOriginal: string;
    try {
      cargoOriginal = readFileSync(cargoPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `write-version: pyproject.toml declares dynamic = ["version"] but Cargo.toml is missing at ${cargoPath}. Maturin's dynamic-version mode reads [package].version from Cargo.toml; without it there's nothing to bump.`,
          { cause: err },
        );
      }
      /* v8 ignore next -- non-ENOENT read errors surface as-is */
      throw err;
    }
    const cargoUpdated = replaceCargoVersion(cargoOriginal, version);
    if (cargoUpdated !== cargoOriginal) writeFileSync(cargoPath, cargoUpdated, 'utf8');
    return cargoPath;
  }

  const pyUpdated = replacePyProjectVersion(pyOriginal, version);
  if (pyUpdated !== pyOriginal) writeFileSync(pyProjectPath, pyUpdated, 'utf8');
  return pyProjectPath;
}

function isDynamicVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}
