/**
 * Pre-build version bump used by `_matrix.yml`'s maturin steps (#276). maturin
 * reads `[package].version` from a sibling `Cargo.toml` at build time and
 * honours no env override (`SETUPTOOLS_SCM_PRETEND_VERSION` is hatch-vcs /
 * setuptools-scm only), so the manifest must be rewritten before the build.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { ErrorCodes } from './error-codes.js';
import { toError } from './to-error.js';
import { writeEmbeddedCrateVersions } from './write-embedded-crate-versions.js';
import { writeResolvedCargoVersion } from './write-resolved-cargo-version.js';

const DYNAMIC_VERSION_DOC_POINTER =
  'https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions';

/**
 * Rewrite the version source for a maturin package; returns the absolute paths
 * modified. pyproject must declare `[project].dynamic = ["version"]`; the bump
 * targets the sibling `Cargo.toml`. A static `[project].version` errors (#333).
 * `try`/`catch (ENOENT)`, not `existsSync` — the precheck is a CodeQL TOCTOU race.
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
    throw toError(err);
  }
  let parsed: unknown;
  try {
    parsed = parseToml(pyOriginal);
  } catch (err) {
    const msg = toError(err).message;
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
    throw toError(err);
  }
  const written = await writeResolvedCargoVersion(pkgDir, cargoOriginal, version);
  // #621: the wheel embeds every in-repo crate the extension module pulls
  // in by path. When the CLI lives in one of those (a Rust core wrapped by
  // this pyo3 crate), its `CARGO_PKG_VERSION` is what `--version` prints.
  const embedded = await writeEmbeddedCrateVersions(pkgDir, version);
  return [...new Set([...written, ...embedded])];
}

function isDynamicVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}
