/**
 * PyPI handler (#17, #623; plan §6.4, §12.2, §12.3, §13.1, §14.5, §16.1). TP
 * matching filters on `repository_owner`/`repository_name` before
 * `job_workflow_ref`, so a cross-repo reusable workflow's token never matches
 * (pypi/warehouse#11096): `publish` uploads nothing, returns `{ status:
 * 'delegated' }`, and the caller's `pypi-publish` job uploads and tags.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { ErrorCodes } from '../error-codes.js';
import type { Ctx, Handler, PublishResult, TrustPosture } from '../types.js';
import { TransientError } from '../types.js';
import { toError } from '../to-error.js';
import { USER_AGENT } from '../version.js';

const REGISTRY = 'https://pypi.org';
const DYNAMIC_VERSION_DOC_POINTER =
  'https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions';

async function isPublishedImpl(
  pkg: { name: string; pypi?: string },
  version: string,
  _ctx: Ctx,
): Promise<boolean> {
  const name = pypiNameFor(pkg);
  const url = `${REGISTRY}/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT },
  });
  if (res.status === 200) {return true;}
  if (res.status === 404) {return false;}
  // 429 (rate limited) is transient: PyPI throttles routine reads, and a
  // TransientError is what withRetry keys on at the isPublished call site. A
  // plain Error carries no `status`, so it would hard-fail the publish instead
  // of retrying. #580.
  if (res.status === 429 || res.status >= 500) {
    throw new TransientError(`pypi.org GET ${url} returned ${res.status}`);
  }
  // Remaining 4xx (400/401/403/…) are hard, non-retryable errors — PyPI
  // returns 200/404 for this endpoint, so anything else is a genuine fault.
  throw new Error(`pypi.org GET ${url} returned ${res.status}`);
}

async function writeVersionImpl(
  pkg: { name?: string; path: string },
  version: string,
  ctx: Ctx,
): Promise<string[]> {
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
  const project = (parsed as { project?: { version?: unknown; dynamic?: unknown } })?.project;
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

async function publishImpl(
  pkg: { name: string; path: string; pypi?: string },
  version: string,
  ctx: Ctx,
): Promise<PublishResult> {
  if (await isPublishedImpl(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  // No upload from here. The engine's role for PyPI is plan + build +
  // version-rewrite — the actual `pypa/gh-action-pypi-publish` call
  // lives in the caller's `pypi-publish` job, where the OIDC claims
  // align with their TP registration. `delegated` is what tells
  // `publish.ts` to hold the tag (#623): nothing is on PyPI yet, and a
  // tag cut here would outlive a run that never reached the upload.
  ctx.log.info(
    [
      `pypi: ${pkg.name}@${version} delegated to caller-side upload step.`,
      '  The upload runs in your `pypi-publish` job via `pypa/gh-action-pypi-publish`;',
      '  the git tag is cut there too, after PyPI confirms the version is live.',
      '  See README → "Publishing to PyPI" for the recipe.',
    ].join('\n'),
  );

  return {
    status: 'delegated',
    url: `${REGISTRY}/project/${pypiNameFor(pkg)}/${version}/`,
  };
}

/* ------------------------------ internals ------------------------------ */

function pypiNameFor(pkg: { name: string; pypi?: string }): string {
  return pkg.pypi ?? pkg.name;
}

/**
 * Returns true when a parsed `[project].dynamic` is an array containing
 * `"version"`. The only accepted version-source shape after #333: the
 * build backend derives the version (hatch-vcs / setuptools-scm read a
 * git tag or `SETUPTOOLS_SCM_PRETEND_VERSION`; maturin reads
 * `Cargo.toml`'s `[package].version`).
 */
function projectDynamicIncludesVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}

/**
 * Latest published version of the project, or null when it has never
 * been published (404). GET /pypi/{name}/json → `info.version`. Reuses
 * `pypiNameFor` so this read resolves the PyPI name exactly as
 * `isPublished` / `publish` do. Any non-200/404 is surfaced as a
 * TransientError; the read-only caller renders that as "unreachable".
 */
async function latestVersionImpl(
  pkg: { name: string; pypi?: string },
  _ctx: Ctx,
): Promise<string | null> {
  const name = pypiNameFor(pkg);
  const url = `${REGISTRY}/pypi/${encodeURIComponent(name)}/json`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { info?: { version?: string } };
    return body.info?.version ?? null;
  }
  if (res.status === 404) {return null;}
  throw new TransientError(`pypi.org GET ${url} returned ${res.status}`);
}

/**
 * Trust posture for a published PyPI version (#414). PyPI exposes
 * PEP 740 attestations per file at `/integrity/{p}/{v}/{file}/provenance`
 * (200 when a trusted-publisher attestation exists, 404 when none). The
 * file list comes from the per-version JSON.
 */
async function trustPostureImpl(
  pkg: { name: string; pypi?: string },
  version: string,
  _ctx: Ctx,
): Promise<TrustPosture> {
  const name = pypiNameFor(pkg);
  const jsonUrl = `${REGISTRY}/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  const jsonRes = await fetch(jsonUrl, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (jsonRes.status !== 200) {
    throw new TransientError(`pypi GET ${jsonUrl} returned ${jsonRes.status}`);
  }
  const body = (await jsonRes.json()) as { urls?: Array<{ filename?: string }> };
  const filename = body.urls?.[0]?.filename;
  // A published version with no files can carry no attestation.
  if (filename === undefined) {return 'token';}
  const provUrl = `${REGISTRY}/integrity/${encodeURIComponent(name)}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}/provenance`;
  const provRes = await fetch(provUrl, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (provRes.status === 200) {return 'oidc';}
  if (provRes.status === 404) {return 'token';}
  throw new TransientError(`pypi GET ${provUrl} returned ${provRes.status}`);
}

export const pypi: Handler = {
  kind: 'pypi',
  isPublished: isPublishedImpl,
  latestVersion: latestVersionImpl,
  trustPosture: trustPostureImpl,
  writeVersion: writeVersionImpl,
  publish: publishImpl,
};
