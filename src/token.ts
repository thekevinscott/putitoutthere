/**
 * `putitoutthere token inspect` — decode/introspect registry tokens.
 *
 * Scaffolding and PyPI offline decode: #107.
 * npm live probe: #108 (whoami + SHA-512 match against /-/npm/v1/tokens).
 * crates.io live probe: #109 (/api/v1/me + /api/v1/me/tokens).
 *
 * Dispatch is driven by token format, not by a hardcoded registry list:
 *   - `pypi-` prefix  → PyPI macaroon decode (offline, full scope)
 *   - `npm_` prefix   → npm (live probe)
 *   - otherwise       → crates.io (live probe), unless `--registry` overrides
 *
 * Token values are never logged. Logs identify a token by the first 8
 * hex chars of its SHA-256. Live probes are timeboxed at 5s per request.
 */

import { createHash } from 'node:crypto';

import { loadConfig, type Package } from './config.js';

export type Registry = 'pypi' | 'npm' | 'crates';

export interface InspectOptions {
  token: string;
  registry?: Registry;
  /** Override live-probe base URL. Tests only. */
  baseUrl?: string;
  /** Override live-probe timeout in ms (default 5000). Tests only. */
  timeoutMs?: number;
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

export interface NpmScopeRow {
  readonly: boolean;
  automation: boolean;
  packages: string[] | null;
  scopes: string[] | null;
  orgs: string[] | null;
  expires_at: string | null;
  cidr_whitelist: string[] | null;
  created: string | null;
}

export interface NpmInspectResult extends BaseResult {
  registry: 'npm';
  format: 'granular' | 'legacy' | 'unknown';
  username: string;
  scope_row: NpmScopeRow | null;
  note?: string;
}

export interface CratesTokenRow {
  name: string;
  endpoint_scopes: string[] | null;
  crate_scopes: string[] | null;
  expired_at: string | null;
}

export interface CratesInspectResult extends BaseResult {
  registry: 'crates';
  username: string;
  account_tokens: CratesTokenRow[] | null;
  bearer_row: null;
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

export async function inspect(opts: InspectOptions): Promise<InspectResult> {
  const token = opts.token;
  const digest = sha256Prefix(token);
  const registry = opts.registry ?? detectRegistry(token);
  const timeoutMs = opts.timeoutMs ?? 5000;

  if (registry === 'pypi') return inspectPypi(token, digest);
  /* v8 ignore next -- default baseUrl for production; tests always inject a mock URL */
  const baseUrl = opts.baseUrl ?? (registry === 'npm' ? NPM_REGISTRY : CRATES_REGISTRY);
  if (registry === 'npm') return inspectNpm(token, digest, baseUrl, timeoutMs);
  return inspectCrates(token, digest, baseUrl, timeoutMs);
}

export function detectRegistry(token: string): Registry {
  if (token.startsWith('pypi-')) return 'pypi';
  if (token.startsWith('npm_')) return 'npm';
  return 'crates';
}

function sha256Prefix(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function sha512Hex(s: string): string {
  return createHash('sha512').update(s).digest('hex');
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

// ---- HTTP helper ------------------------------------------------------

interface ProbeResponse {
  status: number;
  body: unknown;
}

async function probe(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ProbeResponse | { timeout: true }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': 'putitoutthere/0.0.1', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown = null;
    /* v8 ignore next 5 -- registries always return JSON on the endpoints we hit */
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    // Timeout, aborted fetch, and network errors all collapse to the same outcome:
    // the caller treats the probe as a timeout and reports it to the user.
    return { timeout: true };
  }
}

// ---- npm --------------------------------------------------------------

const NPM_REGISTRY = 'https://registry.npmjs.org';

async function inspectNpm(
  token: string,
  digest: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<InspectResult> {
  const authHeader = { authorization: `Bearer ${token}` };
  const format: NpmInspectResult['format'] = token.startsWith('npm_')
    ? 'granular'
    : 'legacy';

  const whoami = await probe(`${baseUrl}/-/whoami`, authHeader, timeoutMs);
  if ('timeout' in whoami) {
    return { registry: 'npm', source_digest: digest, error: 'timeout' };
  }
  if (whoami.status === 401 || whoami.status === 403) {
    return {
      registry: 'npm',
      source_digest: digest,
      error: 'token invalid or expired',
    };
  }
  /* v8 ignore next 7 -- unexpected non-200 from /-/whoami; real responses hit 200/401/403 */
  if (whoami.status !== 200 || !isPlainObject(whoami.body) || typeof whoami.body.username !== 'string') {
    return {
      registry: 'npm',
      source_digest: digest,
      error: `unexpected whoami response (status ${whoami.status})`,
    };
  }
  const username = whoami.body.username;

  const tokens = await probe(`${baseUrl}/-/npm/v1/tokens`, authHeader, timeoutMs);
  if ('timeout' in tokens) {
    return {
      registry: 'npm',
      source_digest: digest,
      error: 'timeout',
    };
  }
  if (tokens.status === 401 || tokens.status === 403) {
    return {
      registry: 'npm',
      source_digest: digest,
      format,
      username,
      scope_row: null,
      note: `tokens endpoint returned ${tokens.status}; only username is confirmed`,
    };
  }
  /* v8 ignore next 10 -- unexpected non-200 from tokens endpoint; 200/401/403 cover real cases */
  if (tokens.status !== 200) {
    return {
      registry: 'npm',
      source_digest: digest,
      format,
      username,
      scope_row: null,
      note: `tokens endpoint returned ${tokens.status}; only username is confirmed`,
    };
  }

  const rows = extractNpmTokenRows(tokens.body);
  const want = sha512Hex(token);
  const match = rows.find((r) => typeof r.key === 'string' && r.key === want);

  if (!match) {
    return {
      registry: 'npm',
      source_digest: digest,
      format,
      username,
      scope_row: null,
      note: 'no SHA-512 match in tokens list (legacy UUID token, or bearer not listable)',
    };
  }

  return {
    registry: 'npm',
    source_digest: digest,
    format,
    username,
    scope_row: normalizeNpmRow(match),
  };
}

interface NpmRawRow {
  key?: unknown;
  token?: unknown;
  readonly?: unknown;
  automation?: unknown;
  cidr_whitelist?: unknown;
  created?: unknown;
  updated?: unknown;
  expires?: unknown;
  scopes?: unknown;
}

function extractNpmTokenRows(body: unknown): NpmRawRow[] {
  if (Array.isArray(body)) return body.filter(isPlainObject) as NpmRawRow[];
  if (isPlainObject(body) && Array.isArray(body.objects)) {
    return body.objects.filter(isPlainObject) as NpmRawRow[];
  }
  return [];
}

function normalizeNpmRow(row: NpmRawRow): NpmScopeRow {
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter((s): s is string => typeof s === 'string')
    : null;
  const packages: string[] = [];
  const orgs: string[] = [];
  const atScopes: string[] = [];
  if (scopes) {
    for (const s of scopes) {
      if (s.startsWith('pkg:')) packages.push(s.slice(4));
      else if (s.startsWith('org:')) orgs.push(s.slice(4));
      else if (s.startsWith('@')) atScopes.push(s);
    }
  }
  return {
    readonly: row.readonly === true,
    automation: row.automation === true,
    packages: packages.length > 0 ? packages : null,
    scopes: atScopes.length > 0 ? atScopes : null,
    orgs: orgs.length > 0 ? orgs : null,
    expires_at: typeof row.expires === 'string' ? row.expires : null,
    cidr_whitelist: Array.isArray(row.cidr_whitelist)
      ? row.cidr_whitelist.filter((c): c is string => typeof c === 'string')
      : null,
    created: typeof row.created === 'string' ? row.created : null,
  };
}

// ---- crates.io --------------------------------------------------------

const CRATES_REGISTRY = 'https://crates.io';

async function inspectCrates(
  token: string,
  digest: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<InspectResult> {
  // crates.io takes the raw token as the Authorization header — no Bearer prefix.
  const authHeader = { authorization: token };

  const me = await probe(`${baseUrl}/api/v1/me`, authHeader, timeoutMs);
  if ('timeout' in me) {
    return { registry: 'crates', source_digest: digest, error: 'timeout' };
  }
  if (me.status === 401 || me.status === 403) {
    return {
      registry: 'crates',
      source_digest: digest,
      error: 'token invalid or expired',
    };
  }
  /* v8 ignore next 7 -- unexpected non-200 from /me; 200/401/403 cover real cases */
  if (me.status !== 200 || !isPlainObject(me.body)) {
    return {
      registry: 'crates',
      source_digest: digest,
      error: `unexpected /me response (status ${me.status})`,
    };
  }
  const username = extractCratesUsername(me.body);
  /* v8 ignore next 7 -- /me schema always includes user.login */
  if (username === null) {
    return {
      registry: 'crates',
      source_digest: digest,
      error: 'could not find username in /me response',
    };
  }

  const tokensRes = await probe(`${baseUrl}/api/v1/me/tokens`, authHeader, timeoutMs);
  if ('timeout' in tokensRes) {
    return { registry: 'crates', source_digest: digest, error: 'timeout' };
  }
  if (tokensRes.status === 401 || tokensRes.status === 403) {
    return {
      registry: 'crates',
      source_digest: digest,
      username,
      account_tokens: null,
      bearer_row: null,
      note: `tokens endpoint returned ${tokensRes.status}; only username is confirmed`,
    };
  }
  /* v8 ignore next 11 -- unexpected non-200 from tokens endpoint; 200/401/403 cover real cases */
  if (tokensRes.status !== 200 || !isPlainObject(tokensRes.body)) {
    return {
      registry: 'crates',
      source_digest: digest,
      username,
      account_tokens: null,
      bearer_row: null,
      note: `tokens endpoint returned ${tokensRes.status}; only username is confirmed`,
    };
  }

  const raw = Array.isArray(tokensRes.body.api_tokens) ? tokensRes.body.api_tokens : [];
  const account_tokens: CratesTokenRow[] = raw.filter(isPlainObject).map(normalizeCratesRow);

  return {
    registry: 'crates',
    source_digest: digest,
    username,
    account_tokens,
    bearer_row: null,
    note: 'crates.io does not expose which row corresponds to the bearer.',
  };
}

function extractCratesUsername(body: Record<string, unknown>): string | null {
  if (isPlainObject(body.user) && typeof body.user.login === 'string') {
    return body.user.login;
  }
  /* v8 ignore next 3 -- alternate shape guard; /me always returns {user:{login}} */
  if (typeof body.login === 'string') return body.login;
  return null;
}

function normalizeCratesRow(row: Record<string, unknown>): CratesTokenRow {
  return {
    name: typeof row.name === 'string' ? row.name : '(unnamed)',
    endpoint_scopes: Array.isArray(row.endpoint_scopes)
      ? row.endpoint_scopes.filter((s): s is string => typeof s === 'string')
      : null,
    crate_scopes: Array.isArray(row.crate_scopes)
      ? row.crate_scopes.filter((s): s is string => typeof s === 'string')
      : null,
    expired_at: typeof row.expired_at === 'string' ? row.expired_at : null,
  };
}

// ---- token list -------------------------------------------------------

export interface TokenListRow {
  registry: Registry;
  source: 'env';
  name: string;
  details: string;
}

export interface TokenListOptions {
  /** Working dir used to locate putitoutthere.toml when no `packages` is passed. */
  cwd?: string;
  configPath?: string;
  /** Env to scan. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Override the packages list (skips config load). Tests pass this
   * directly; the CLI path loads it from disk.
   */
  packages?: readonly Package[];
}

// Crates has no identifying prefix, so we only classify an opaque env var
// as crates when its *name* is the one the crates handler reads. Kept in
// sync with src/preflight.ts TOKEN_ENV['crates'].
const CRATES_ENV_NAMES: ReadonlySet<string> = new Set(['CARGO_REGISTRY_TOKEN']);

/**
 * Enumerate registry tokens discoverable to the CLI from the environment.
 *
 * Classification is by *value format*:
 *   - `pypi-` prefix → PyPI macaroon
 *   - `npm_`  prefix → npm granular
 *   - opaque value under a crates-recognized env var, iff the config has a
 *     crates package → crates.io
 *
 * Token values are never returned or logged.
 *
 * Issue #106. Ships env-only; `--secrets` (repo/env/org secret listing via
 * the stored GitHub user access token) is gated on #105.
 */
export function tokenList(opts: TokenListOptions = {}): TokenListRow[] {
  const env = opts.env ?? process.env;
  const packages = resolvePackages(opts);
  const hasCrates = packages.some((p) => p.kind === 'crates');

  const rows: TokenListRow[] = [];
  for (const [name, raw] of Object.entries(env)) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value === '') continue;
    if (value.startsWith('pypi-')) {
      rows.push({ registry: 'pypi', source: 'env', name, details: 'pypi- prefix, macaroon' });
    } else if (value.startsWith('npm_')) {
      rows.push({ registry: 'npm', source: 'env', name, details: 'npm_ prefix (granular)' });
    } else if (hasCrates && CRATES_ENV_NAMES.has(name)) {
      rows.push({ registry: 'crates', source: 'env', name, details: 'opaque (from config)' });
    }
    // anything else: ignored. We never dump the full environment.
  }
  rows.sort((a, b) => (a.registry === b.registry ? a.name.localeCompare(b.name) : a.registry.localeCompare(b.registry)));
  return rows;
}

function resolvePackages(opts: TokenListOptions): readonly Package[] {
  if (opts.packages !== undefined) return opts.packages;
  const cwd = opts.cwd ?? process.cwd();
  const cfgPath = opts.configPath ?? `${cwd.replace(/\/+$/, '')}/putitoutthere.toml`;
  try {
    return loadConfig(cfgPath).packages;
  } catch {
    // No config / unreadable config → env-only, prefix-based classification
    // still works. Crates opaque-tokens are skipped (no config to key on).
    return [];
  }
}
