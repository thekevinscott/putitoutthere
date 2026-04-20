/**
 * `putitoutthere token inspect` — decode/introspect registry tokens.
 *
 * Issue #107 (scaffold + PyPI). npm and crates.io live probes land in
 * #108 and #109 respectively; their handlers return a `pending`
 * placeholder until then.
 *
 * Dispatch is driven by token format, not by a hardcoded registry list:
 *   - `pypi-` prefix  → PyPI macaroon decode (offline, full scope)
 *   - `npm_` prefix   → npm (#108)
 *   - otherwise       → crates.io (#109), unless `--registry` overrides
 *
 * Token values are never logged. Logs identify a token by the first 8
 * hex chars of its SHA-256.
 */

import { createHash } from 'node:crypto';

export type Registry = 'pypi' | 'npm' | 'crates';

export interface InspectOptions {
  token: string;
  registry?: Registry;
}

export type InspectResult =
  | PypiInspectResult
  | NpmInspectResult
  | CratesInspectResult
  | InspectErrorResult;

interface BaseResult {
  registry: Registry;
  source_digest: string;
}

export interface PypiInspectResult extends BaseResult {
  registry: 'pypi';
  format: 'macaroon';
  identifier: Record<string, unknown> | null;
  restrictions: Restriction[];
  expired: boolean;
}

export type Restriction =
  | { type: 'ProjectNames'; names: string[] }
  | { type: 'ProjectIDs'; ids: string[] }
  | { type: 'Date'; not_before?: number; not_after?: number }
  | { type: 'Unknown'; raw: Record<string, unknown> };

export interface NpmInspectResult extends BaseResult {
  registry: 'npm';
  format: 'granular' | 'legacy' | 'unknown';
  status: 'pending';
  note: string;
}

export interface CratesInspectResult extends BaseResult {
  registry: 'crates';
  status: 'pending';
  note: string;
}

export interface InspectErrorResult {
  registry: Registry | 'unknown';
  source_digest: string;
  error: string;
}

export function isError(r: InspectResult): r is InspectErrorResult {
  return 'error' in r;
}

export function inspect(opts: InspectOptions): InspectResult {
  const token = opts.token;
  const digest = sha256Prefix(token);
  const registry = opts.registry ?? detectRegistry(token);

  if (registry === 'pypi') return inspectPypi(token, digest);
  if (registry === 'npm') return inspectNpmPlaceholder(token, digest);
  return inspectCratesPlaceholder(digest);
}

export function detectRegistry(token: string): Registry {
  if (token.startsWith('pypi-')) return 'pypi';
  if (token.startsWith('npm_')) return 'npm';
  return 'crates';
}

function sha256Prefix(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

// ---- PyPI --------------------------------------------------------------

const PYPI_PREFIX = 'pypi-';

function inspectPypi(token: string, digest: string): InspectResult {
  if (!token.startsWith(PYPI_PREFIX)) {
    return {
      registry: 'pypi',
      source_digest: digest,
      error: 'token does not start with "pypi-"',
    };
  }

  const body = token.slice(PYPI_PREFIX.length);
  const bytes = tryBase64Decode(body);
  if (!bytes) {
    return {
      registry: 'pypi',
      source_digest: digest,
      error: 'invalid base64 in token body',
    };
  }

  const blobs = extractJsonObjects(bytes);
  if (blobs.length === 0) {
    return {
      registry: 'pypi',
      source_digest: digest,
      error: 'no parseable macaroon payload found',
    };
  }

  const identifier = blobs[0] as Record<string, unknown>;
  const caveatBlobs = blobs.slice(1);
  const restrictions = caveatBlobs.map(toRestriction);
  const expired = hasExpired(restrictions);

  return {
    registry: 'pypi',
    source_digest: digest,
    format: 'macaroon',
    identifier,
    restrictions,
    expired,
  };
}

/**
 * Try base64 decode — accept both standard and URL-safe alphabets, with
 * or without padding. PyPI macaroons have been serialized with both
 * variants historically.
 */
function tryBase64Decode(s: string): Uint8Array | null {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const bin = Buffer.from(normalized + padding, 'base64');
  if (bin.length === 0) return null;
  return new Uint8Array(bin);
}

/**
 * Walk the decoded macaroon bytes looking for top-level JSON objects.
 * PyPI's macaroon identifier and every caveat are JSON blobs embedded
 * in an otherwise-binary envelope; we don't need the full pymacaroons
 * parser to pull them out.
 */
function extractJsonObjects(bytes: Uint8Array): Array<Record<string, unknown>> {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const results: Array<Record<string, unknown>> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') {
      i++;
      continue;
    }
    const end = findMatchingBrace(text, i);
    if (end === -1) {
      i++;
      continue;
    }
    const candidate = text.slice(i, end + 1);
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isPlainObject(parsed)) {
        results.push(parsed);
        i = end + 1;
        continue;
      }
    } catch {
      /* fall through */
    }
    i++;
  }
  return results;
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Map a decoded caveat JSON blob to a typed `Restriction`. Caveat
 * shapes evolved — see pypi/warehouse#11873 and pypitoken docs. We
 * support the common shapes and preserve anything unknown verbatim.
 */
function toRestriction(raw: Record<string, unknown>): Restriction {
  // v2 compact shapes: {version: 1, projects: [...]}
  if (Array.isArray(raw.projects) && raw.projects.every((p) => typeof p === 'string')) {
    return { type: 'ProjectNames', names: raw.projects };
  }
  if (Array.isArray(raw.project_ids) && raw.project_ids.every((p) => typeof p === 'string')) {
    return { type: 'ProjectIDs', ids: raw.project_ids };
  }
  // v1 legacy shape: {permissions: {projects: [...]}}
  if (isPlainObject(raw.permissions) && Array.isArray(raw.permissions.projects)) {
    const projects = raw.permissions.projects.filter(
      (p): p is string => typeof p === 'string',
    );
    return { type: 'ProjectNames', names: projects };
  }
  // Date restriction: {nbf: <unix>, exp: <unix>} or {not_before / not_after}
  if (typeof raw.nbf === 'number' || typeof raw.exp === 'number') {
    const out: { type: 'Date'; not_before?: number; not_after?: number } = { type: 'Date' };
    if (typeof raw.nbf === 'number') out.not_before = raw.nbf;
    if (typeof raw.exp === 'number') out.not_after = raw.exp;
    return out;
  }
  if (typeof raw.not_before === 'number' || typeof raw.not_after === 'number') {
    const out: { type: 'Date'; not_before?: number; not_after?: number } = { type: 'Date' };
    if (typeof raw.not_before === 'number') out.not_before = raw.not_before;
    if (typeof raw.not_after === 'number') out.not_after = raw.not_after;
    return out;
  }
  return { type: 'Unknown', raw };
}

function hasExpired(restrictions: Restriction[]): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const r of restrictions) {
    if (r.type !== 'Date') continue;
    if (typeof r.not_after === 'number' && r.not_after < now) return true;
  }
  return false;
}

// ---- npm (placeholder; #108) ------------------------------------------

function inspectNpmPlaceholder(token: string, digest: string): NpmInspectResult {
  const format: NpmInspectResult['format'] = token.startsWith('npm_') ? 'granular' : 'unknown';
  return {
    registry: 'npm',
    source_digest: digest,
    format,
    status: 'pending',
    note: 'npm live probe not yet implemented (see #108)',
  };
}

// ---- crates.io (placeholder; #109) ------------------------------------

function inspectCratesPlaceholder(digest: string): CratesInspectResult {
  return {
    registry: 'crates',
    source_digest: digest,
    status: 'pending',
    note: 'crates.io live probe not yet implemented (see #109)',
  };
}
