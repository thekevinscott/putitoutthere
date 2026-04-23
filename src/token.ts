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
import { execFileSync } from 'node:child_process';

import { loadConfig, type Package } from './config.js';
import { defaultKeyring, type Keyring } from './keyring.js';
import { USER_AGENT } from './version.js';

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
      headers: { 'user-agent': USER_AGENT, ...headers },
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
  source: 'env' | 'repo-secret' | 'environment-secret';
  name: string;
  details: string;
  /** Populated only when source = 'environment-secret'. */
  environment?: string;
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

// ---- token list --secrets ---------------------------------------------

/**
 * Classify a GitHub Actions secret *by name* to a registry. The API never
 * exposes secret values, so prefix-by-value classification (the env-var
 * path) is unavailable here. Conservative: unrecognized names return
 * `null` and are omitted from the listing rather than dumping every
 * secret on the repo.
 *
 * Exact matches line up with `src/preflight.ts#TOKEN_ENV`, plus the
 * common `TWINE_PASSWORD` / `PYPI_TOKEN` aliases used in the wild.
 * Prefixed names (`NPM_FOO`, `PYPI_BAR`, `CARGO_FOO`, `TWINE_FOO`)
 * are treated as likely-registry.
 */
export function classifySecretName(name: string): Registry | null {
  if (name === 'CARGO_REGISTRY_TOKEN') return 'crates';
  if (name === 'NPM_TOKEN' || name === 'NODE_AUTH_TOKEN') return 'npm';
  if (name === 'PYPI_API_TOKEN' || name === 'PYPI_TOKEN' || name === 'TWINE_PASSWORD') return 'pypi';
  if (name.startsWith('CARGO_')) return 'crates';
  if (name.startsWith('NPM_')) return 'npm';
  if (name.startsWith('PYPI_') || name.startsWith('TWINE_')) return 'pypi';
  return null;
}

export interface SecretListOptions {
  /** Working dir used to resolve the git remote when `repo` is omitted. */
  cwd?: string;
  /** Repo as "owner/name". Defaults to $GITHUB_REPOSITORY or parsed from `git remote get-url origin`. */
  repo?: string;
  keyring?: Keyring;
  fetchFn?: typeof fetch;
  /**
   * Override GitHub API base URL. Tests only: honored only when
   * NODE_ENV === 'test' (#139). In production callers, an arbitrary
   * base URL would be an SSRF lever (attacker-controlled URL receives
   * a Bearer-token GET against internal services); gating on NODE_ENV
   * keeps that lever out of reach outside the test harness. Vitest
   * sets NODE_ENV=test by default, so this is transparent to the
   * existing suite.
   */
  apiBase?: string;
  /** Per-request timeout. Defaults to 5000ms. */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface EnvSecretError {
  environment: string;
  message: string;
}

export type SecretListOutcome =
  | { kind: 'not_logged_in'; message: string }
  | { kind: 'no_repo'; message: string }
  | { kind: 'error'; message: string; rows: TokenListRow[] }
  | { kind: 'ok'; rows: TokenListRow[]; envErrors?: EnvSecretError[] };

const GITHUB_API = 'https://api.github.com';

/**
 * List GitHub Actions secrets (repo + environment) whose names look like
 * registry credentials. Uses the stored user access token from the
 * `Keyring` (populated by `auth login`).
 *
 * Secret *values* are never returned — the GitHub API doesn't expose
 * them. Classification is by name (see `classifySecretName`).
 *
 * Degrades gracefully: missing keyring, unresolvable repo, 401/403 from
 * GitHub, and network errors all become outcome kinds rather than
 * thrown errors. The caller decides whether to surface them.
 */
export async function tokenListSecrets(opts: SecretListOptions = {}): Promise<SecretListOutcome> {
  const keyring = opts.keyring ?? defaultKeyring();
  const fetchFn = opts.fetchFn ?? fetch;
  // #139: apiBase is test-only. Silently ignore the override outside
  // the vitest harness so production callers can't smuggle an
  // attacker-controlled URL in and earn a Bearer-token GET against it.
  const apiBase =
    opts.apiBase !== undefined && process.env.NODE_ENV === 'test'
      ? opts.apiBase
      : GITHUB_API;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const env = opts.env ?? process.env;

  const stored = await keyring.get();
  if (!stored) {
    return {
      kind: 'not_logged_in',
      message: '--secrets: not logged in. Run `putitoutthere auth login` to list repo secrets.',
    };
  }

  const repo = opts.repo ?? resolveRepo(env, opts.cwd ?? process.cwd());
  if (repo === null) {
    return {
      kind: 'no_repo',
      message: '--secrets: could not resolve owner/repo from $GITHUB_REPOSITORY or git remote "origin".',
    };
  }

  const auth = `Bearer ${stored.access_token}`;
  const rows: TokenListRow[] = [];

  const repoSecrets = await ghGetJson(fetchFn, `${apiBase}/repos/${repo}/actions/secrets`, auth, timeoutMs);
  if (repoSecrets.kind === 'error') {
    return {
      kind: 'error',
      message: `--secrets: listing repo secrets failed: ${repoSecrets.message}`,
      rows,
    };
  }
  for (const s of extractSecretNames(repoSecrets.body)) {
    const reg = classifySecretName(s);
    if (reg !== null) {
      rows.push({ registry: reg, source: 'repo-secret', name: s, details: `repo secret (${repo})` });
    }
  }

  const envsRes = await ghGetJson(fetchFn, `${apiBase}/repos/${repo}/environments`, auth, timeoutMs);
  const envErrors: EnvSecretError[] = [];
  if (envsRes.kind === 'ok') {
    const envNames = extractEnvironmentNames(envsRes.body);
    // Fan out per-environment secret lookups concurrently (#143): GitHub
    // rate-limits by req/h not concurrency, and a serial loop adds a
    // full RTT per environment. allSettled preserves partial results —
    // one flaky environment no longer nukes the whole list.
    const settled = await Promise.allSettled(
      envNames.map(async (envName) => {
        const encoded = encodeURIComponent(envName);
        const envSecrets = await ghGetJson(
          fetchFn,
          `${apiBase}/repos/${repo}/environments/${encoded}/secrets`,
          auth,
          timeoutMs,
        );
        return { envName, envSecrets };
      }),
    );
    for (const s of settled) {
      /* v8 ignore next 4 -- ghGetJson returns a tagged union and never rejects; defence-in-depth */
      if (s.status === 'rejected') {
        envErrors.push({ environment: '(unknown)', message: String(s.reason) });
        continue;
      }
      const { envName, envSecrets } = s.value;
      if (envSecrets.kind !== 'ok') {
        envErrors.push({ environment: envName, message: envSecrets.message });
        continue;
      }
      for (const sec of extractSecretNames(envSecrets.body)) {
        const reg = classifySecretName(sec);
        if (reg !== null) {
          rows.push({
            registry: reg,
            source: 'environment-secret',
            name: sec,
            details: `environment secret (${envName})`,
            environment: envName,
          });
        }
      }
    }
  }
  // envs endpoint 404 on repos without environments configured; treat as no envs, keep repo rows.

  rows.sort((a, b) => {
    if (a.registry !== b.registry) return a.registry.localeCompare(b.registry);
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.name.localeCompare(b.name);
  });

  return envErrors.length > 0 ? { kind: 'ok', rows, envErrors } : { kind: 'ok', rows };
}

type GhResult =
  | { kind: 'ok'; body: unknown }
  | { kind: 'error'; message: string };

async function ghGetJson(
  fetchFn: typeof fetch,
  url: string,
  authorization: string,
  timeoutMs: number,
): Promise<GhResult> {
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        authorization,
        accept: 'application/vnd.github+json',
        'user-agent': 'putitoutthere',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) {
      return { kind: 'ok', body: { not_found: true } };
    }
    if (!res.ok) {
      return { kind: 'error', message: `HTTP ${res.status}` };
    }
    const body: unknown = await res.json();
    return { kind: 'ok', body };
  /* v8 ignore next 3 -- network/timeout path; msw covers HTTP error paths, real throws aren't reachable in tests */
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'unknown network error' };
  }
}

function extractSecretNames(body: unknown): string[] {
  if (!isPlainObject(body) || !Array.isArray(body.secrets)) return [];
  const out: string[] = [];
  for (const s of body.secrets) {
    if (isPlainObject(s) && typeof s.name === 'string') out.push(s.name);
  }
  return out;
}

function extractEnvironmentNames(body: unknown): string[] {
  if (!isPlainObject(body)) return [];
  if (body.not_found === true) return [];
  if (!Array.isArray(body.environments)) return [];
  const out: string[] = [];
  for (const e of body.environments) {
    if (isPlainObject(e) && typeof e.name === 'string') out.push(e.name);
  }
  return out;
}

/**
 * Resolve "owner/repo" from, in order:
 *   1. `GITHUB_REPOSITORY` env var (CI case)
 *   2. `git remote get-url origin`, parsing common GitHub URL shapes:
 *      - `https://github.com/owner/repo(.git)?`
 *      - `git@github.com:owner/repo(.git)?`
 *      - `ssh://git@github.com/owner/repo(.git)?`
 */
export function resolveRepo(env: NodeJS.ProcessEnv, cwd: string): string | null {
  const fromEnv = env.GITHUB_REPOSITORY;
  if (typeof fromEnv === 'string' && /^[^/\s]+\/[^/\s]+$/.test(fromEnv)) {
    return fromEnv;
  }
  let url: string;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  return parseGithubRemote(url);
}

export function parseGithubRemote(url: string): string | null {
  // https://github.com/<owner>/<repo>(.git)?
  const https = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  if (https) return `${https[1]}/${https[2]}`;
  // git@github.com:<owner>/<repo>(.git)?
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  // ssh://git@github.com/<owner>/<repo>(.git)?
  const sshProto = /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  if (sshProto) return `${sshProto[1]}/${sshProto[2]}`;
  return null;
}
