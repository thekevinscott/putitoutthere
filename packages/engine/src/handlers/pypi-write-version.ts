import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { ErrorCodes } from '../error-codes.js';
import type { Ctx } from '../types.js';
import { toError } from '../to-error.js';

export async function pypiWriteVersion(
  pkg: { name?: string; path: string },
  version: string,
  ctx: Ctx,
): Promise<string[]> {
  const DYNAMIC_VERSION_DOC_POINTER =
    'https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions';
  const pyProjectPath = join(pkg.path, 'pyproject.toml');
  let original: string;
  try {
    original = await readFile(pyProjectPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`pyproject.toml not found at ${pyProjectPath}`, { cause: err });
    }
    throw toError(err);
  }
  let parsed: unknown;
  try {
    parsed = parseToml(original);
  } catch (err) {
    throw new Error(`pyproject.toml: failed to parse ${pyProjectPath}: ${toError(err).message}`, { cause: err });
  }
  const project = (parsed as { project?: { version?: unknown; dynamic?: unknown } }).project;
  if (!project) {
    throw new Error(
      `pyproject.toml has no [project] table -- declare [project].dynamic = ["version"] with hatch-vcs (or setuptools-scm / maturin Cargo.toml). See ${DYNAMIC_VERSION_DOC_POINTER}.`,
    );
  }
  if (projectDynamicIncludesVersion(project)) {
    // Dynamic-version: hatch-vcs / setuptools-scm read the version
    // from a git tag or `SETUPTOOLS_SCM_PRETEND_VERSION`; maturin
    // reads it from `Cargo.toml`'s `[package].version`. In every case
    // pyproject.toml is the wrong file to rewrite; the build job is
    // responsible for setting the version source before `python -m
    // build` / `maturin build` runs. Per design-commitment #1 (no
    // version computation), we surface guidance and exit.
    const who = pkg.name ? `pypi: ${pkg.name}` : 'pypi';
    ctx.log.info(
      [
        `${who}: detected dynamic version; nothing to rewrite in pyproject.toml.`,
        `  Planned version: ${version}. Pass it to the build backend via one of:`,
        `    - SETUPTOOLS_SCM_PRETEND_VERSION=${version}  (hatch-vcs / setuptools-scm)`,
        // Per-package `_FOR_<SUFFIX>` variants exist in setuptools-scm but
        // are silently ignored by hatch-vcs; only the global env var works
        // across both backends. Match what the reusable workflow actually
        // sets in `_matrix.yml`. See README → "Python version source".
        `    - Update [package].version in Cargo.toml  (maturin reading Cargo)`,
        `  Set the env var on the build job, before \`python -m build\` / \`maturin build\` runs.`,
        `  See ${DYNAMIC_VERSION_DOC_POINTER}`,
      ].join('\n'),
    );
    return [];
  }
  // Static literal — not allowed. Preflight should have rejected this
  // already (`requirePypiVersionSource` runs before any writeVersion
  // call on the publish path), but the CLI `write-version` subcommand
  // can be invoked directly; guard here so the failure mode is the
  // same actionable error rather than a silent rewrite. See #333.
  if (typeof project.version === 'string') {
    throw new Error(
      `[${ErrorCodes.PYPI_STATIC_VERSION}] pyproject.toml at ${pyProjectPath} declares a static \`[project].version\` literal. Use \`[project].dynamic = ["version"]\` with hatch-vcs (recommended), setuptools-scm, or the maturin Cargo.toml-driven path — putitoutthere does not edit pyproject.toml at release time. See ${DYNAMIC_VERSION_DOC_POINTER}.`,
    );
  }
  throw new Error(
    `pyproject.toml at ${pyProjectPath}: [project] table declares no version source -- add \`dynamic = ["version"]\`. See ${DYNAMIC_VERSION_DOC_POINTER}.`,
  );
}

function projectDynamicIncludesVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}
