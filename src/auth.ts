/**
 * `auth login/logout/status` — OAuth Device Flow against the
 * `putitoutthere-cli` GitHub App (client ID committed to
 * docs/guide/auth.md).
 *
 * Scope: optional. The rest of the CLI authenticates to registries
 * via env vars; this subcommand exists so `token list` (and later
 * features) can read repo-secret metadata from GitHub on behalf of
 * the user. If `auth login` has never been run, those features
 * degrade gracefully — see #98.
 *
 * Token values are never logged or written to stdout. They flow
 * through the `Keyring` abstraction (see `src/keyring.ts`); in logs
 * a token is identified by the first 8 hex chars of its SHA-256.
 */

import { defaultKeyring, type Keyring, type StoredAuth } from './keyring.js';

/** Public client ID of the `putitoutthere-cli` GitHub App (#104). */
export const CLIENT_ID = 'Iv23lio0NtN1koa0Rwle';

const GITHUB_DEVICE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER = 'https://api.github.com/user';

const GRANT_DEVICE = 'urn:ietf:params:oauth:grant-type:device_code';
const GRANT_REFRESH = 'refresh_token';

/** Seconds of slack to refresh a token before it actually expires. */
const REFRESH_SKEW_SECONDS = 60;

/** Bumped when GitHub returns `slow_down`. */
const SLOW_DOWN_BUMP_SECONDS = 5;

export interface LoginOptions {
  /** Override the App client ID. Tests inject a fake. */
  clientId?: string;
  fetchFn?: typeof fetch;
  keyring?: Keyring;
  /** Epoch-seconds clock. Defaults to `Date.now()/1000`. */
  now?: () => number;
  /** Awaitable delay between polls. Defaults to real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Surface the verification prompt to the user. Callers that want
   * human-readable output (the CLI) provide one that writes to stderr;
   * tests pass a capture. Defaults to a no-op.
   */
  onPrompt?: (prompt: DevicePrompt) => void;
}

export interface DevicePrompt {
  userCode: string;
  verificationUri: string;
  /** Raw seconds-from-now until the device_code expires. */
  expiresInSeconds: number;
}

export interface LoginResult {
  account: string;
  /** Epoch seconds at which the *access* token expires. */
  expiresAt: number;
}

export interface LogoutOptions {
  keyring?: Keyring;
}

export interface StatusOptions {
  fetchFn?: typeof fetch;
  keyring?: Keyring;
  now?: () => number;
}

export type StatusResult =
  | { authenticated: true; account: string; expiresAt: number }
  | {
      authenticated: false;
      reason: 'not_logged_in' | 'refresh_failed' | 'revoked';
      message: string;
    };

// ---- login -------------------------------------------------------------

export async function login(opts: LoginOptions = {}): Promise<LoginResult> {
  const clientId = opts.clientId ?? CLIENT_ID;
  const fetchFn = opts.fetchFn ?? fetch;
  const keyring = opts.keyring ?? defaultKeyring();
  const now = opts.now ?? epochSeconds;
  const sleep = opts.sleep ?? realSleep;
  const onPrompt = opts.onPrompt ?? (() => undefined);

  const device = await requestDeviceCode(fetchFn, clientId);
  onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresInSeconds: device.expires_in,
  });

  const tokens = await pollForToken(fetchFn, sleep, clientId, device);
  const account = await fetchLogin(fetchFn, tokens.access_token);

  const issuedAt = now();
  const stored: StoredAuth = {
    account,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: issuedAt + tokens.expires_in,
    refresh_token_expires_at: issuedAt + tokens.refresh_token_expires_in,
  };
  await keyring.set(stored);

  return { account, expiresAt: stored.access_token_expires_at };
}

// ---- logout ------------------------------------------------------------

export async function logout(opts: LogoutOptions = {}): Promise<{ wiped: boolean }> {
  const keyring = opts.keyring ?? defaultKeyring();
  const existing = await keyring.get();
  if (!existing) return { wiped: false };
  await keyring.delete();
  return { wiped: true };
}

// ---- status ------------------------------------------------------------

export async function status(opts: StatusOptions = {}): Promise<StatusResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const keyring = opts.keyring ?? defaultKeyring();
  const now = opts.now ?? epochSeconds;

  const stored = await keyring.get();
  if (!stored) {
    return {
      authenticated: false,
      reason: 'not_logged_in',
      message: 'Not logged in. Run `putitoutthere auth login`.',
    };
  }

  let working = stored;
  const soonExpired = now() >= stored.access_token_expires_at - REFRESH_SKEW_SECONDS;
  if (soonExpired) {
    const refreshed = await tryRefresh(fetchFn, keyring, working, now);
    if (!refreshed) {
      return {
        authenticated: false,
        reason: 'refresh_failed',
        message: 'Session expired. Run `putitoutthere auth login`.',
      };
    }
    working = refreshed;
  }

  const probe = await probeUser(fetchFn, working.access_token);
  if (probe.ok) {
    return {
      authenticated: true,
      account: probe.login,
      expiresAt: working.access_token_expires_at,
    };
  }
  if (probe.status !== 401) {
    // Network or 5xx — don't wipe credentials over a transient blip.
    return {
      authenticated: false,
      reason: 'refresh_failed',
      message: `GitHub /user probe failed (${probe.status}).`,
    };
  }
  // 401 with a still-unexpired token => credential actually revoked.
  // Try one refresh before giving up, in case the server clock drifted.
  const refreshed = await tryRefresh(fetchFn, keyring, working, now);
  if (!refreshed) {
    return {
      authenticated: false,
      reason: 'revoked',
      message: 'Token rejected by GitHub. Run `putitoutthere auth login`.',
    };
  }
  const reprobe = await probeUser(fetchFn, refreshed.access_token);
  if (!reprobe.ok) {
    return {
      authenticated: false,
      reason: 'revoked',
      message: 'Token rejected by GitHub. Run `putitoutthere auth login`.',
    };
  }
  return {
    authenticated: true,
    account: reprobe.login,
    expiresAt: refreshed.access_token_expires_at,
  };
}

// ---- Device Flow internals --------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  token_type: string;
  scope: string;
}

async function requestDeviceCode(
  fetchFn: typeof fetch,
  clientId: string,
): Promise<DeviceCodeResponse> {
  const res = await fetchFn(GITHUB_DEVICE_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ client_id: clientId }).toString(),
  });
  if (!res.ok) {
    throw new Error(`device code request failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  /* v8 ignore next 3 -- defensive; GitHub always returns the documented fields on 2xx. */
  if (!isDeviceCodeResponse(body)) {
    throw new Error('device code response missing expected fields');
  }
  return body;
}

async function pollForToken(
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  clientId: string,
  device: DeviceCodeResponse,
): Promise<TokenResponse> {
  let intervalSec = device.interval;
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalSec * 1000);
    const res = await fetchFn(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: device.device_code,
        grant_type: GRANT_DEVICE,
      }).toString(),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (isTokenResponse(body)) return body;
    const error = typeof body.error === 'string' ? body.error : 'unknown_error';
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      intervalSec += SLOW_DOWN_BUMP_SECONDS;
      continue;
    }
    if (error === 'access_denied') {
      throw new Error('authorization denied by user');
    }
    if (error === 'expired_token') {
      throw new Error('device code expired before approval');
    }
    /* v8 ignore start -- unknown error codes + wall-clock deadline are both defensive; GitHub's error set is exhaustive and the server's expired_token fires first. */
    throw new Error(`device flow error: ${error}`);
  }
  throw new Error('device code expired before approval');
}
/* v8 ignore stop */

async function tryRefresh(
  fetchFn: typeof fetch,
  keyring: Keyring,
  current: StoredAuth,
  now: () => number,
): Promise<StoredAuth | null> {
  const res = await fetchFn(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      refresh_token: current.refresh_token,
      grant_type: GRANT_REFRESH,
    }).toString(),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, unknown>;
  if (!isTokenResponse(body)) return null;
  const issuedAt = now();
  const next: StoredAuth = {
    account: current.account,
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    access_token_expires_at: issuedAt + body.expires_in,
    refresh_token_expires_at: issuedAt + body.refresh_token_expires_in,
  };
  await keyring.set(next);
  return next;
}

async function fetchLogin(fetchFn: typeof fetch, accessToken: string): Promise<string> {
  const res = await fetchFn(GITHUB_API_USER, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'putitoutthere',
    },
  });
  /* v8 ignore next 3 -- fetchLogin runs only after a successful token grant; the happy-path is covered. */
  if (!res.ok) {
    throw new Error(`GitHub /user failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  /* v8 ignore next 3 -- defensive: GitHub has never shipped /user without a login field. */
  if (typeof body.login !== 'string') {
    throw new Error('GitHub /user response missing login');
  }
  return body.login;
}

type ProbeResult =
  | { ok: true; login: string }
  | { ok: false; status: number };

async function probeUser(fetchFn: typeof fetch, accessToken: string): Promise<ProbeResult> {
  try {
    const res = await fetchFn(GITHUB_API_USER, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'putitoutthere',
      },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as Record<string, unknown>;
    /* v8 ignore next -- defensive: GitHub has never shipped /user without a login field. */
    if (typeof body.login !== 'string') return { ok: false, status: res.status };
    return { ok: true, login: body.login };
  /* v8 ignore next 3 -- network-throw catch; msw can't model a pre-HTTP throw cleanly. */
  } catch {
    return { ok: false, status: 0 };
  }
}

// ---- helpers -----------------------------------------------------------

function isDeviceCodeResponse(v: unknown): v is DeviceCodeResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.device_code === 'string' &&
    typeof o.user_code === 'string' &&
    typeof o.verification_uri === 'string' &&
    typeof o.expires_in === 'number' &&
    typeof o.interval === 'number'
  );
}

function isTokenResponse(v: unknown): v is TokenResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.access_token === 'string' &&
    typeof o.expires_in === 'number' &&
    typeof o.refresh_token === 'string' &&
    typeof o.refresh_token_expires_in === 'number'
  );
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/* v8 ignore next 3 -- real timer; every test injects `sleep`. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
