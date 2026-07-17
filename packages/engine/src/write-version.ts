/**
 * Pre-build version bump used by `_matrix.yml`'s maturin steps. #276.
 *
 * Maturin reads `[package].version` from a sibling `Cargo.toml` (when
 * pyproject declares `dynamic = ["version"]`) at build time. There is
 * no env override the build job can inject —
 * `SETUPTOOLS_SCM_PRETEND_VERSION` is honored by hatch-vcs /
 * setuptools-scm but not by maturin. So Cargo.toml has to be
 * rewritten before `maturin build` runs. crates and npm bump at
 * publish (cargo / npm read the manifest at upload time, not before);
 * maturin is the one path where the artifact (the wheel) leaves the
 * build runner already versioned.
 *
 * Static `[project].version` literals are rejected at preflight time
 * (`requirePypiVersionSource`); this function refuses the same shape
 * for the same reason, so a CLI-direct invocation surfaces the same
 * actionable error rather than building an under-versioned artifact.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { ErrorCodes } from './error-codes.js';
import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

const DYNAMIC_VERSION_DOC_POINTER =
  'https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions';

/**
 * Rewrite the version source for a maturin package and return the list
 * of absolute paths that were modified.
 *
 * Contract: pyproject must declare `[project].dynamic = ["version"]`.
 * The bump targets the sibling `Cargo.toml`'s `[package].version`.
 * Errors if Cargo.toml is missing, pyproject is missing, pyproject is
 * malformed, the `[project]` table is absent, or pyproject carries a
 * static `[project].version` literal (#333).
 *
 * I/O uses `readFileSync` with `try` / `catch (ENOENT)` instead of an
 * `existsSync` precheck — the precheck is a TOCTOU race CodeQL flags
 * (`pull/277` advisories #13, #14), and `pypi.writeVersion` already
 * uses the same try/catch shape we mirror here.
 */
export async function writeVersionForBuild(pkgDir: string, version: string): Promise<string[]> {
  const pyProjectPath = join(pkgDir, 'pyproject.toml');
  let pyOriginal: string;
  try {
    pyOriginal = await readFile(pyProjectPath, 'utf8');
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
    /* v8 ignore start -- smol-toml always throws an Error; the String(err) fallback is unreachable */
    const msg = err instanceof Error ? err.message : String(err);
    /* v8 ignore stop */
    throw new Error(`write-version: failed to parse ${pyProjectPath}: ${msg}`, { cause: err });
  }
  const project = (parsed as { project?: { version?: unknown; dynamic?: unknown } })?.project;
  if (!project) {
    throw new Error(
      `write-version: ${pyProjectPath} has no [project] table -- declare [project].dynamic = ["version"]. See ${DYNAMIC_VERSION_DOC_POINTER}.`,
    );
  }
  if (!isDynamicVersion(project)) {
    if (typeof project.version === 'string') {
      throw new Error(
        `[${ErrorCodes.PYPI_STATIC_VERSION}] write-version: ${pyProjectPath} declares a static \`[project].version\` literal. Use \`[project].dynamic = ["version"]\` with hatch-vcs (recommended), setuptools-scm, or the maturin Cargo.toml-driven path — putitoutthere does not edit pyproject.toml at release time. See ${DYNAMIC_VERSION_DOC_POINTER}.`,
      );
    }
    throw new Error(
      `write-version: ${pyProjectPath}: [project] table declares no version source -- add \`dynamic = ["version"]\`. See ${DYNAMIC_VERSION_DOC_POINTER}.`,
    );
  }

  const cargoPath = join(pkgDir, 'Cargo.toml');
  let cargoOriginal: string;
  try {
    cargoOriginal = await readFile(cargoPath, 'utf8');
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
  return await writeResolvedCargoVersion(pkgDir, cargoOriginal, version);
}

function isDynamicVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}
