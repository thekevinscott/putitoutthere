/**
 * PyPI handler.
 *
 * **Architectural note (2026-04-28).** PyPI's Trusted Publisher matching
 * filters candidate publishers by `repository_owner` + `repository_name`
 * before checking `job_workflow_ref`. When OIDC tokens are minted from
 * inside a cross-repo reusable workflow, the `repository` claim is the
 * *caller's* repo and `job_workflow_ref` is the reusable workflow's
 * path — so a TP registered against the reusable workflow's repo is
 * filtered out before workflow_ref is even checked. PyPI documents this
 * as unsupported and tracks the fix at pypi/warehouse#11096 (no
 * timeline). See `notes/audits/2026-04-28-pypi-tp-reusable-workflow-
 * constraint.md`.
 *
 * Consequence for `putitoutthere`: the engine cannot upload to PyPI
 * from inside the reusable workflow's publish job. The actual upload
 * is delegated to a caller-side `pypi-publish` job that runs
 * `pypa/gh-action-pypi-publish` from the consumer's own workflow
 * context (where both `repository` and `job_workflow_ref` align with
 * the consumer's repo + their TP registration). The reusable workflow
 * still emits the matrix, builds artifacts, and creates+pushes git
 * tags; only the upload step moves.
 *
 * The handler therefore:
 *  - `isPublished`: unchanged. Public PyPI HEAD; no auth needed.
 *  - `writeVersion`: unchanged. Rewrites `[project].version` in-place
 *    or logs a SETUPTOOLS_SCM hint for dynamic-version projects.
 *  - `publish`: NO upload. Returns `{ status: 'published' }` so
 *    `publish.ts` creates+pushes the git tag. The tag is the engine's
 *    record-of-intent; the caller's `pypi-publish` job performs the
 *    actual upload using `pypa/gh-action-pypi-publish` (which is
 *    idempotent, so a transient caller-side failure is recoverable
 *    by re-triggering).
 *
 * Issue #17. Plan: §6.4, §12.2, §12.3, §13.1, §14.5, §16.1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { Ctx, Handler, PublishResult } from '../types.js';
import { TransientError } from '../types.js';
import { USER_AGENT } from '../version.js';

const REGISTRY = 'https://pypi.org';

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
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  if (res.status >= 500) {
    throw new TransientError(`pypi.org GET ${url} returned ${res.status}`);
  }
  /* v8 ignore next -- defensive 4xx fallthrough; PyPI returns 200/404 for this endpoint */
  throw new Error(`pypi.org GET ${url} returned ${res.status}`);
}

function writeVersionImpl(
  pkg: { name?: string; path: string },
  version: string,
  ctx: Ctx,
): Promise<string[]> {
  const pyProjectPath = join(pkg.path, 'pyproject.toml');
  let original: string;
  try {
    original = readFileSync(pyProjectPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Promise.reject(new Error(`pyproject.toml not found at ${pyProjectPath}`));
    }
    /* v8 ignore next -- non-ENOENT read errors surface as-is */
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  // Single TOML parse site: distinguishes (a) malformed TOML, (b) no [project]
  // table, (c) [project] present but without static or dynamic version.
  // The regex rewrite below only runs for case (c)-that-resolves-successfully.
  let parsed: unknown;
  try {
    parsed = parseToml(original);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Promise.reject(new Error(`pyproject.toml: failed to parse ${pyProjectPath}: ${msg}`));
  }
  const project = (parsed as { project?: { dynamic?: unknown } })?.project;
  if (!project) {
    return Promise.reject(
      new Error(
        'pyproject.toml has no [project] table -- declare [project].version or [project].dynamic = ["version"]',
      ),
    );
  }
  // Dynamic-version projects (hatch-vcs, setuptools-scm, maturin reading
  // Cargo.toml, etc) have `dynamic = [..., "version", ...]` under [project]
  // and no literal version line to rewrite. The build backend derives the
  // version itself. Per design-commitment #1 (no version computation),
  // skip the rewrite -- the consumer's build system handles propagation.
  // Surface an actionable guidance line so adopters aren't left guessing
  // how the planned version reaches the build backend. See #207.
  if (projectDynamicIncludesVersion(project)) {
    const who = pkg.name ? `pypi: ${pkg.name}` : 'pypi';
    const envSuffix = pkg.name ? scmEnvSuffix(pkg.name) : '<PKG>';
    ctx.log.info(
      [
        `${who}: detected dynamic version; skipping pyproject.toml rewrite.`,
        `  Planned version: ${version}. Pass it to the build backend via one of:`,
        `    - SETUPTOOLS_SCM_PRETEND_VERSION_FOR_${envSuffix}=${version}  (hatch-vcs / setuptools-scm)`,
        `    - Update [package].version in Cargo.toml                ${' '.repeat(Math.max(0, envSuffix.length - 12))}  (maturin reading Cargo)`,
        `  Set the env var on the build job, before \`python -m build\` / \`maturin build\` runs.`,
        `  See https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions`,
      ].join('\n'),
    );
    return Promise.resolve([]);
  }
  let updated: string;
  try {
    updated = replacePyProjectVersion(original, version);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  if (updated === original) return Promise.resolve([]);
  writeFileSync(pyProjectPath, updated, 'utf8');
  return Promise.resolve([pyProjectPath]);
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
  // version-rewrite + tag — the actual `pypa/gh-action-pypi-publish`
  // call lives in the caller's `pypi-publish` job, where the OIDC
  // claims align with their TP registration. Returning 'published'
  // triggers `publish.ts` to create + push the git tag, which is the
  // engine's record-of-intent and the signal the caller's job uses to
  // know there's work to do.
  ctx.log.info(
    [
      `pypi: ${pkg.name}@${version} delegated to caller-side upload step.`,
      '  The engine creates and pushes the git tag from this job; the actual',
      '  upload runs in your `pypi-publish` job via `pypa/gh-action-pypi-publish`.',
      '  See README → "Publishing to PyPI" for the recipe.',
    ].join('\n'),
  );

  return {
    status: 'published',
    url: `${REGISTRY}/project/${pypiNameFor(pkg)}/${version}/`,
  };
}

/* ------------------------------ internals ------------------------------ */

function pypiNameFor(pkg: { name: string; pypi?: string }): string {
  return pkg.pypi ?? pkg.name;
}

/**
 * Rewrites the first `version = "x.y.z"` inside the `[project]` table.
 *
 * Precondition: the caller has already confirmed a `[project]` table exists
 * and does not declare `dynamic = ["version"]`. Throws when no literal
 * `version = "..."` line can be located inside `[project]`.
 */
export function replacePyProjectVersion(source: string, version: string): string {
  const re = /(\[project\][\s\S]*?)(^\s*version\s*=\s*")([^"]*)(")/m;
  const m = re.exec(source);
  if (!m) {
    throw new Error(
      'pyproject.toml: [project] is present but declares neither a static version nor dynamic = ["version"]',
    );
  }
  const [, pre, prefix, old, suffix] = m as unknown as [string, string, string, string, string];
  if (old === version) return source;
  const start = m.index + pre.length;
  const end = start + prefix.length + old.length + suffix.length;
  return source.slice(0, start) + prefix + version + suffix + source.slice(end);
}

/**
 * Returns true when a parsed `[project].dynamic` is an array containing
 * `"version"`. Used to detect hatch-vcs / setuptools-scm / maturin setups
 * where the build backend computes the version and no literal
 * `version = "..."` line exists to rewrite.
 */
function projectDynamicIncludesVersion(project: { dynamic?: unknown }): boolean {
  const { dynamic } = project;
  return Array.isArray(dynamic) && dynamic.includes('version');
}

/**
 * `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<SUFFIX>` name suffix derived from
 * a package name per PEP 503's canonical normalisation. Uppercase,
 * dashes + dots + underscores all collapse to a single underscore.
 */
export function scmEnvSuffix(pkgName: string): string {
  return pkgName.replace(/[-._]+/g, '_').toUpperCase();
}

export const pypi: Handler = {
  kind: 'pypi',
  isPublished: isPublishedImpl,
  writeVersion: writeVersionImpl,
  publish: publishImpl,
};
