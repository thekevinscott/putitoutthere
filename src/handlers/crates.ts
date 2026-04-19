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
 *   already-published (idempotent). Honors ctx.dryRun.
 *
 * OIDC: the crates-io-auth-action GHA step exchanges the OIDC JWT for
 * a short-lived CARGO_REGISTRY_TOKEN in the env. The handler doesn't
 * drive the exchange -- it just reads the env var the workflow wired
 * up (same for classic token fallback).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Ctx, Handler, PublishResult } from '../types.js';
import { TransientError } from '../types.js';

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
    headers: { 'user-agent': 'putitoutthere/0.0.1' },
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
  if (!existsSync(cargoPath)) {
    return Promise.reject(new Error(`Cargo.toml not found at ${cargoPath}`));
  }
  const original = readFileSync(cargoPath, 'utf8');
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
  pkg: { name: string; path: string; crate?: string },
  version: string,
  ctx: Ctx,
): Promise<PublishResult> {
  if (await isPublishedImpl(pkg, version, ctx)) {
    return { status: 'already-published' };
  }
  if (ctx.dryRun) {
    return { status: 'skipped' };
  }

  try {
    execFileSync('cargo', ['publish', '--allow-dirty', '--verbose', '--manifest-path', join(pkg.path, 'Cargo.toml')], {
      cwd: ctx.cwd,
      env: {
        ...process.env,
        ...ctx.env,
        CARGO_TERM_VERBOSE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8').trim();
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(`cargo publish failed${stderr ? `:\n${stderr}` : `: ${base}`}`);
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

export const crates: Handler = {
  kind: 'crates',
  isPublished: isPublishedImpl as Handler['isPublished'],
  writeVersion: writeVersionImpl as Handler['writeVersion'],
  publish: publishImpl as Handler['publish'],
};
