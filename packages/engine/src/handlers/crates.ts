/**
 * crates.io handler.
 *
 * Issue #16. Plan: §7.4, §13.1, §14.5, §16.1.
 *
 * - isPublished: GET /api/v1/crates/{name}/{version}; 200 → true, 404 →
 *   false, 5xx → TransientError (retry-wrapped at call site).
 * - writeVersion: edits the [package] version line in Cargo.toml in
 *   place. Regex-based to preserve comments and whitespace; the
 *   alternative (TOML round-trip) loses formatting.
 * - publish: `cargo publish --allow-dirty --verbose` with stderr
 *   captured for the failure dump. Short-circuits on
 *   already-published (idempotent).
 *
 * --allow-dirty is required for our writeVersion-then-publish model
 * (#135), but cargo's default dirty-check is exactly the safety net
 * that catches shipping uncommitted stray edits. We restore a
 * narrower version of that check: before invoking cargo, scan the
 * working tree via `git status --porcelain` and refuse to publish
 * if anything is dirty outside the Cargo.toml we just wrote. If we
 * can't scan (e.g. no git repo), we fall back to cargo's own
 * --allow-dirty behavior.
 *
 * OIDC: the crates-io-auth-action GHA step exchanges the OIDC JWT for
 * a short-lived CARGO_REGISTRY_TOKEN in the env. The handler doesn't
 * drive the exchange -- it just reads the env var the workflow wired
 * up (same for classic token fallback).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { Ctx, Handler, PublishResult, TrustPosture } from '../types.js';
import { TransientError } from '../types.js';
import { ErrorCodes } from '../error-codes.js';
import { buildSubprocessEnv, nonEmpty } from '../env.js';
import { USER_AGENT } from '../version.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

const REGISTRY = 'https://crates.io';

async function isPublishedImpl(
  pkg: { name: string; crate?: string },
  version: string,
  _ctx: Ctx,
): Promise<boolean> {
  const crateName = crateNameFor(pkg);
  const url = `${REGISTRY}/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT },
  });
  if (res.status === 200) {return true;}
  if (res.status === 404) {return false;}
  if (res.status >= 500) {
    throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
  }
  /* v8 ignore next -- defensive 4xx fallthrough; crates.io returns 200/404 for this endpoint */
  throw new Error(`crates.io GET ${url} returned ${res.status}`);
}

async function writeVersionImpl(
  pkg: { path: string },
  version: string,
  _ctx: Ctx,
): Promise<string[]> {
  const cargoPath = join(pkg.path, 'Cargo.toml');
  let original: string;
  try {
    original = await readFile(cargoPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Cargo.toml not found at ${cargoPath}`, { cause: err });
    }
    /* v8 ignore next -- non-ENOENT read errors are rare (perms/io); surface as-is */
    throw err instanceof Error ? err : new Error(String(err));
  }
  let updated: string;
  try {
    updated = replaceCargoVersion(original, version);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (updated === original) {return [];}
  await writeFile(cargoPath, updated, 'utf8');
  return [cargoPath];
}

async function publishImpl(
  pkg: { name: string; path: string; crate?: string; features?: string[]; no_default_features?: boolean },
  version: string,
  ctx: Ctx,
): Promise<PublishResult> {
  if (await isPublishedImpl(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  // #135: --allow-dirty disarms cargo's own "is the tree clean?" guard.
  // Reinstate a narrower check: only the Cargo.toml we just wrote may
  // be dirty. Anything else = a bug or a stray edit that would end up
  // in the crate tarball. Published crates can't be unpublished.
  //
  // Sibling package paths are whitelisted: a polyglot consumer with
  // rust + js packages will have install state (node_modules/, dist/,
  // package-lock.json) inside the js package's path during publish
  // (the reusable workflow's `Build npm packages` step runs
  // `npm install + npm run build` per npm package before the engine
  // publishes). cargo only packs files inside its own package dir, so
  // sibling-package state can't end up in the crate tarball anyway.
  const unexpected = await scanDirtyOutsideManifest(
    ctx.cwd,
    pkg.path,
    ctx.artifactsRoot,
    ctx.siblingPackagePaths,
  );
  if (unexpected !== null && unexpected.length > 0) {
    throw new Error(
      [
        `cargo publish: refusing to proceed; unexpected dirty files in the working tree outside ${relativeOrSelf(ctx.cwd, join(pkg.path, 'Cargo.toml'))}:`,
        ...unexpected.map((p) => `  - ${p}`),
        'Commit or stash these before publishing (putitoutthere passes --allow-dirty to cargo only to permit the managed version bump).',
      ].join('\n'),
    );
  }

  // #169: thread configured features through so cargo's publish-time
  // verification build exercises the same gates users will pull in.
  // Without this, a crate with a broken `cli` feature ships regardless.
  const baseArgs = ['publish', '--allow-dirty', '--verbose', '--manifest-path', join(pkg.path, 'Cargo.toml')];
  if (pkg.features && pkg.features.length > 0) {
    baseArgs.push('--features', pkg.features.join(','));
  }
  if (pkg.no_default_features === true) {
    baseArgs.push('--no-default-features');
  }

  // #331: internal e2e seams. `PIOT_CRATES_REGISTRY_PRIMARY` forces all
  // publish traffic at an alt-registry (the symmetric counterpart of
  // npm's `PIOT_NPM_REGISTRY`, for any future `*-first-publish` crates
  // fixture). `PIOT_CRATES_REGISTRY_FALLBACK` is a 429-only retry seam:
  // when real crates.io rate-limits routine PR-cadence e2e traffic
  // ("You have published too many versions of this crate in the last 24
  // hours"), retry once against the alt-registry so the run goes green.
  // Both are workflow-only — consumer production releases set neither
  // env var, so the publish path through this handler is byte-identical
  // to today's real-crates.io-only behavior in that case.
  const primaryOverride = nonEmpty(ctx.env.PIOT_CRATES_REGISTRY_PRIMARY);
  const fallbackUrl = nonEmpty(ctx.env.PIOT_CRATES_REGISTRY_FALLBACK);

  const runPublish = async (registryUrl?: string): Promise<void> => {
    // cargo refuses to invoke `publish --index <url>` without an
    // explicit `--token` argument at the CLI parser level — neither
    // CARGO_REGISTRY_TOKEN nor credentials.toml entries unblock it.
    // The alt-registry this workflow ships with (cargo-http-registry,
    // see e2e-fixture-job.yml) is configured `--no-auth` so any token
    // string is accepted; the value here is a placeholder for the CLI
    // to be willing to dispatch, not a secret. The primary path
    // (registryUrl undefined) leaves CARGO_REGISTRY_TOKEN handling
    // alone — that's the real-crates.io OIDC token exported by the
    // `rust-lang/crates-io-auth-action` workflow step.
    const args = registryUrl
      ? [...baseArgs, '--index', registryUrl, '--token', 'piot-alt-registry-placeholder']
      : baseArgs;
    await execCapture('cargo', args, {
      cwd: ctx.cwd,
      // #138: minimal env. The parent process.env leaks unrelated
      // secrets to cargo; forward only a known-safe baseline plus the
      // workflow-declared ctx.env (which carries CARGO_REGISTRY_TOKEN
      // and OIDC vars when present).
      env: buildSubprocessEnv(ctx.env, { CARGO_TERM_VERBOSE: 'true' }),
    });
  };

  try {
    await runPublish(primaryOverride);
  } catch (err) {
    const stderr = err instanceof ExecError ? err.stderr.trim() : undefined;
    // 429-only fallback. Predicate scoped narrowly to rate-limit prose
    // so non-rate-limit failures (auth, network, validation) surface
    // verbatim. Only fires when the workflow provisioned a fallback AND
    // a primary override isn't already in effect (primary is
    // authoritative for first-publish fixtures).
    if (
      primaryOverride === undefined &&
      fallbackUrl !== undefined &&
      isRateLimited(stderr)
    ) {
      // Surface the fallback engaging as a GH annotation so a reviewer
      // sees the real crates.io path was NOT exercised on this run and
      // isn't misled by the green check.
      process.stdout.write(
        `::warning::crates.io returned 429; falling back to ${fallbackUrl} (real OIDC-TP path not exercised this run)\n`,
      );
      try {
        await runPublish(fallbackUrl);
      } catch (retryErr) {
        const retryStderr = retryErr instanceof ExecError ? retryErr.stderr.trim() : undefined;
        const retryBase = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(
          `cargo publish (fallback ${fallbackUrl}) failed${retryStderr ? `:\n${retryStderr}` : `: ${retryBase}`}`,
          { cause: retryErr },
        );
      }
      return {
        status: 'published',
        url: `${fallbackUrl.replace(/\/$/, '')}/api/v1/crates/${crateNameFor(pkg)}/${version}`,
      };
    }
    // crates.io's Trusted Publishing binds to an already-published
    // crate: the OIDC mint succeeds and the exchanged token reaches
    // cargo, but the registry returns a 404 ("crate `<name>` does not
    // exist or you do not have permission to publish to it") on the
    // very first publish. The naive "auth failed?" interpretation
    // sends consumers down a credentials rabbit-hole when the real
    // fix is one bootstrap publish with a classic CARGO_REGISTRY_TOKEN.
    // Detect this exact shape and surface the bootstrap hint inline.
    // Suppressed under the e2e seam (primary override in effect) — the
    // alt-registry is configured `--no-auth` and doesn't model TP, so
    // a 404 there is a different bug. #284.
    if (
      primaryOverride === undefined &&
      looksLikeFirstPublishTpRejection(stderr)
    ) {
      throw new Error(
        [
          `[${ErrorCodes.CRATES_FIRST_PUBLISH_TP_REJECTED}] cargo publish: crates.io rejected publishing "${crateNameFor(pkg)}" because the crate has never been published.`,
          'crates.io Trusted Publishing binds to an already-published crate, so the very first release of a new crate name cannot use the TP path.',
          'Bootstrap by setting CARGO_REGISTRY_TOKEN (a classic crates.io API token) for the first publish; every release after that can use trusted publishing.',
          stderr ? `\n--- cargo stderr ---\n${stderr}` : '',
        ].filter((s) => s.length > 0).join('\n'),
        { cause: err },
      );
    }
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(`cargo publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`, { cause: err });
  }

  return {
    status: 'published',
    url: primaryOverride
      ? `${primaryOverride.replace(/\/$/, '')}/api/v1/crates/${crateNameFor(pkg)}/${version}`
      : `${REGISTRY}/crates/${crateNameFor(pkg)}/${version}`,
  };
}

/**
 * Match cargo's 429 stderr shape. crates.io renders this verbatim under
 * a `Caused by:` block:
 *   the remote server responded with an error (status 429 Too Many Requests):
 *   You have published too many versions of this crate in the last 24 hours
 * The two-anchor match (status + 429) keeps false positives out: an
 * unrelated "429 in 10 minutes" string in some other failure mode
 * wouldn't trigger the fallback.
 */
function isRateLimited(stderr: string | undefined): boolean {
  if (!stderr) {return false;}
  return /status\s+429\b/i.test(stderr) || /429\s+Too\s+Many\s+Requests/i.test(stderr);
}

/**
 * Match cargo's stderr shape when crates.io rejects the TP exchange
 * because the crate has never been published. The fixture at
 * `tests/integration/fixtures/registry-responses/crates-io/publish-first-publish-tp-rejected.txt`
 * captures the canonical shape; the catalog at
 * `notes/upstream-behaviors.md` is the source of truth for the contract.
 *
 * Two anchors keep false positives out: a 404-status line and either
 * the registry's "crate `<name>` does not exist" prose or the
 * "trusted publish" mention. An unrelated 404 in some other cargo
 * subcommand (e.g. a missing index file) won't carry the prose; an
 * unrelated `does not exist` (e.g. a missing dependency) won't carry
 * the 404 status.
 */
export function looksLikeFirstPublishTpRejection(stderr: string | undefined): boolean {
  if (!stderr) {return false;}
  if (!/status\s+404\b/i.test(stderr)) {return false;}
  return (
    /crate\s+`[^`]+`\s+does\s+not\s+exist/i.test(stderr) ||
    /trusted\s+publish/i.test(stderr)
  );
}

/* ------------------------------ internals ------------------------------ */

/** The published name. Falls back to the pilot package name if no
 * explicit `crate` field is set. */
function crateNameFor(pkg: { name: string; crate?: string }): string {
  return pkg.crate ?? pkg.name;
}

/**
 * Rewrites the first `version = "..."` assignment inside `[package]`.
 * Preserves everything else in the file byte-for-byte. Throws if the
 * field isn't found (explicit config error; fail loud rather than
 * silently creating a half-broken manifest).
 */
export function replaceCargoVersion(source: string, version: string): string {
  // Match [package] section header then a version = "x.y.z" line.
  // Captures leading indent + `version = "` + old version + trailing.
  const re = /(\[package\][\s\S]*?)(^\s*version\s*=\s*")([^"]*)(")/m;
  const m = re.exec(source);
  if (!m) {
    throw new Error('Cargo.toml: no [package].version field found');
  }
  const [, pre, prefix, old, suffix] = m as unknown as [string, string, string, string, string];
  if (old === version) {return source;}
  const start = m.index + pre.length;
  const end = start + prefix.length + old.length + suffix.length;
  return source.slice(0, start) + prefix + version + suffix + source.slice(end);
}

/**
 * Return paths of dirty working-tree files that are NOT the package's
 * managed Cargo.toml. Returns null if we can't determine (not inside
 * a git work tree, git command missing, etc) — callers treat null as
 * "can't verify, fall through to cargo's own --allow-dirty behavior."
 */
export async function scanDirtyOutsideManifest(
  cwd: string,
  pkgPath: string,
  artifactsRoot?: string,
  siblingPackagePaths?: readonly string[],
): Promise<string[] | null> {
  // Confirm we're inside a git work tree. If not, bail and let cargo's
  // own --allow-dirty handling take over.
  try {
    const topOut = (await execCapture('git', ['rev-parse', '--show-toplevel'], {
      cwd,
    })).stdout;
    if (!topOut.trim()) {return null;}
  } catch {
    return null;
  }
  // Ask git for the managed file's path relative to the repo root, so
  // we can string-compare against porcelain output directly without
  // fighting platform path conventions (macOS /private/ symlinks,
  // Windows 8.3 short names + case-insensitive FS).
  let managedRel = '';
  try {
    managedRel = (await execCapture('git', ['ls-files', '--full-name', '--', 'Cargo.toml'], {
      cwd: pkgPath,
    })).stdout.trim();
    /* v8 ignore next 4 -- Cargo.toml is always tracked at publish time */
  } catch {
    // Cargo.toml not tracked (e.g. first release on a fresh tree).
    // Fall through; empty managedRel means nothing is allowed dirty.
  }
  let porcelain: string;
  try {
    porcelain = (await execCapture('git', ['status', '--porcelain'], {
      cwd,
    })).stdout;
    /* v8 ignore start -- rev-parse succeeded above, status shouldn't fail */
  } catch {
    return null;
  }
  /* v8 ignore stop */
  // Reusable workflow's `actions/download-artifact@v4` step creates
  // `artifacts/` under cwd unconditionally — even for fixtures whose
  // packages don't upload anything (crates-only). That entry is engine-
  // managed scratch space, not a stray edit; skip it.
  let artifactsRel = '';
  if (artifactsRoot !== undefined && artifactsRoot !== '') {
    const r = relative(cwd, artifactsRoot);
    artifactsRel = r === '' ? '' : r.replace(/\\/g, '/');
  }
  // Sibling package directories — anything inside them is workflow
  // state from another handler (e.g. node_modules/ + package-lock.json
  // + dist/ from the npm `Build npm packages` step). cargo only packs
  // files inside its own package dir, so these can't end up in the
  // crate tarball regardless of whether they're "dirty" by git's view.
  const siblingRels: string[] = [];
  for (const p of siblingPackagePaths ?? []) {
    const r = relative(cwd, p);
    if (r === '' || r.startsWith('..')) {continue;}
    siblingRels.push(r.replace(/\\/g, '/'));
  }
  const unexpected: string[] = [];
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) {continue;}
    // Porcelain v1: "XY path" or "XY old -> new" for renames. Index 3+
    // is the path; strip quoting if git applied any.
    const rest = raw.slice(3);
    /* v8 ignore next -- rename-row rendering not exercised by current tests */
    const path = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest;
    /* v8 ignore next -- quoted-path rendering not exercised by current tests */
    const normalized = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
    if (normalized === managedRel) {continue;}
    if (
      artifactsRel !== '' &&
      (normalized === artifactsRel ||
        normalized === `${artifactsRel}/` ||
        normalized.startsWith(`${artifactsRel}/`))
    ) {
      continue;
    }
    if (
      siblingRels.some(
        (s) =>
          normalized === s ||
          normalized === `${s}/` ||
          normalized.startsWith(`${s}/`),
      )
    ) {
      continue;
    }
    unexpected.push(normalized);
  }
  return unexpected;
}

function relativeOrSelf(base: string, target: string): string {
  const r = relative(base, target);
  /* v8 ignore next -- relative() only returns '' when base === target */
  return r === '' ? target : r;
}

/**
 * Latest published version of the crate, or null when it has never been
 * published (404). GET /api/v1/crates/{name} → `crate.newest_version`.
 * Reuses `crateNameFor` so this read resolves the crates.io name exactly
 * as `isPublished` / `publish` do. Any non-200/404 is surfaced as a
 * TransientError; the read-only caller renders that as "unreachable".
 */
async function latestVersionImpl(
  pkg: { name: string; crate?: string },
  _ctx: Ctx,
): Promise<string | null> {
  const crateName = crateNameFor(pkg);
  const url = `${REGISTRY}/api/v1/crates/${encodeURIComponent(crateName)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { crate?: { newest_version?: string } };
    return body.crate?.newest_version ?? null;
  }
  if (res.status === 404) {return null;}
  throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
}

/**
 * Trust posture for a published crate version (#414). crates.io's version
 * endpoint exposes `trustpub_data` ({provider, repository, …}) when the
 * version was published via Trusted Publishing (OIDC); a token publish
 * leaves it null and names a `published_by` user.
 */
async function trustPostureImpl(
  pkg: { name: string; crate?: string },
  version: string,
  _ctx: Ctx,
): Promise<TrustPosture> {
  const crateName = crateNameFor(pkg);
  const url = `${REGISTRY}/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { version?: { trustpub_data?: unknown } };
    return body.version?.trustpub_data ? 'oidc' : 'token';
  }
  throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
}

export const crates: Handler = {
  kind: 'crates',
  isPublished: isPublishedImpl,
  latestVersion: latestVersionImpl,
  trustPosture: trustPostureImpl,
  writeVersion: writeVersionImpl,
  publish: publishImpl,
};
