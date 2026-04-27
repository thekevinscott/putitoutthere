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

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Ctx, Handler, PublishResult } from '../types.js';
import { TransientError } from '../types.js';
import { buildSubprocessEnv } from '../env.js';
import { USER_AGENT } from '../version.js';

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
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  if (res.status >= 500) {
    throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
  }
  /* v8 ignore next -- defensive 4xx fallthrough; crates.io returns 200/404 for this endpoint */
  throw new Error(`crates.io GET ${url} returned ${res.status}`);
}

function writeVersionImpl(
  pkg: { path: string },
  version: string,
  _ctx: Ctx,
): Promise<string[]> {
  const cargoPath = join(pkg.path, 'Cargo.toml');
  let original: string;
  try {
    original = readFileSync(cargoPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Promise.reject(new Error(`Cargo.toml not found at ${cargoPath}`));
    }
    /* v8 ignore next -- non-ENOENT read errors are rare (perms/io); surface as-is */
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  let updated: string;
  try {
    updated = replaceCargoVersion(original, version);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  if (updated === original) return Promise.resolve([]);
  writeFileSync(cargoPath, updated, 'utf8');
  return Promise.resolve([cargoPath]);
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
  const unexpected = scanDirtyOutsideManifest(ctx.cwd, pkg.path);
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
  const args = ['publish', '--allow-dirty', '--verbose', '--manifest-path', join(pkg.path, 'Cargo.toml')];
  if (pkg.features && pkg.features.length > 0) {
    args.push('--features', pkg.features.join(','));
  }
  if (pkg.no_default_features === true) {
    args.push('--no-default-features');
  }

  try {
    execFileSync('cargo', args, {
      cwd: ctx.cwd,
      // #138: minimal env. The parent process.env leaks unrelated
      // secrets to cargo; forward only a known-safe baseline plus the
      // workflow-declared ctx.env (which carries CARGO_REGISTRY_TOKEN
      // and OIDC vars when present).
      env: buildSubprocessEnv(ctx.env, { CARGO_TERM_VERBOSE: 'true' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(`cargo publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`, { cause: err });
  }

  return {
    status: 'published',
    url: `${REGISTRY}/crates/${crateNameFor(pkg)}/${version}`,
  };
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
  if (old === version) return source;
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
export function scanDirtyOutsideManifest(
  cwd: string,
  pkgPath: string,
): string[] | null {
  // Confirm we're inside a git work tree. If not, bail and let cargo's
  // own --allow-dirty handling take over.
  try {
    const topOut = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!topOut.trim()) return null;
  } catch {
    return null;
  }
  // Ask git for the managed file's path relative to the repo root, so
  // we can string-compare against porcelain output directly without
  // fighting platform path conventions (macOS /private/ symlinks,
  // Windows 8.3 short names + case-insensitive FS).
  let managedRel = '';
  try {
    managedRel = execFileSync('git', ['ls-files', '--full-name', '--', 'Cargo.toml'], {
      cwd: pkgPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    /* v8 ignore next 4 -- Cargo.toml is always tracked at publish time */
  } catch {
    // Cargo.toml not tracked (e.g. first release on a fresh tree).
    // Fall through; empty managedRel means nothing is allowed dirty.
  }
  let porcelain: string;
  try {
    porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /* v8 ignore start -- rev-parse succeeded above, status shouldn't fail */
  } catch {
    return null;
  }
  /* v8 ignore stop */
  const unexpected: string[] = [];
  for (const raw of porcelain.split('\n')) {
    if (raw.length < 4) continue;
    // Porcelain v1: "XY path" or "XY old -> new" for renames. Index 3+
    // is the path; strip quoting if git applied any.
    const rest = raw.slice(3);
    /* v8 ignore next -- rename-row rendering not exercised by current tests */
    const path = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest;
    /* v8 ignore next -- quoted-path rendering not exercised by current tests */
    const normalized = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
    if (normalized === managedRel) continue;
    unexpected.push(normalized);
  }
  return unexpected;
}

function relativeOrSelf(base: string, target: string): string {
  const r = relative(base, target);
  /* v8 ignore next -- relative() only returns '' when base === target */
  return r === '' ? target : r;
}

export const crates: Handler = {
  kind: 'crates',
  isPublished: isPublishedImpl,
  writeVersion: writeVersionImpl,
  publish: publishImpl,
};
