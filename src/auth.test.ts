/**
 * Auth unit tests.
 *
 * GitHub endpoints (device/code, oauth/access_token, api/user) are
 * mocked with msw. Keyring calls go through an in-memory stub so we
 * never touch the filesystem and can observe every write.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { login, logout, status } from './auth.js';
import type { Keyring, StoredAuth } from './keyring.js';

const DEVICE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function memoryKeyring(initial: StoredAuth | null = null): Keyring & { snapshot: () => StoredAuth | null } {
  let current: StoredAuth | null = initial;
  return {
    get() { return Promise.resolve(current); },
    set(a: StoredAuth) { current = a; return Promise.resolve(); },
    delete() { current = null; return Promise.resolve(); },
    snapshot: () => current,
  };
}

function deviceResponse(overrides: Partial<{ interval: number; expires_in: number }> = {}) {
  return {
    device_code: 'devcode-123',
    user_code: 'ABCD-1234',
    verification_uri: 'https://github.com/login/device',
    expires_in: overrides.expires_in ?? 900,
    interval: overrides.interval ?? 5,
  };
}

function tokenResponse(overrides: Partial<{ access_token: string; expires_in: number; refresh_token: string; refresh_token_expires_in: number }> = {}) {
  return {
    access_token: overrides.access_token ?? 'ghu_test_access',
    expires_in: overrides.expires_in ?? 28800,
    refresh_token: overrides.refresh_token ?? 'ghr_test_refresh',
    refresh_token_expires_in: overrides.refresh_token_expires_in ?? 15897600,
    token_type: 'bearer',
    scope: '',
  };
}

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

describe('auth.login', () => {
  it('happy path: approved on first poll, stores token + account', async () => {
    server.use(
      http.post(DEVICE_URL, () => HttpResponse.json(deviceResponse())),
      http.post(TOKEN_URL, () => HttpResponse.json(tokenResponse())),
      http.get(USER_URL, () => HttpResponse.json({ login: 'octocat' })),
    );
    const keyring = memoryKeyring();
    const prompts: string[] = [];

    const result = await login({
      keyring,
      sleep: noSleep,
      now: () => 1_000_000,
      onPrompt: (p) => prompts.push(`${p.userCode} @ ${p.verificationUri}`),
    });

    expect(result).toEqual({ account: 'octocat', expiresAt: 1_000_000 + 28800 });
    expect(prompts).toEqual(['ABCD-1234 @ https://github.com/login/device']);
    const snap = keyring.snapshot();
    expect(snap?.account).toBe('octocat');
    expect(snap?.access_token).toBe('ghu_test_access');
    expect(snap?.refresh_token).toBe('ghr_test_refresh');
  });

  it('polls through authorization_pending until approved', async () => {
    let pollCount = 0;
    server.use(
      http.post(DEVICE_URL, () => HttpResponse.json(deviceResponse())),
      http.post(TOKEN_URL, () => {
        pollCount++;
        if (pollCount < 3) {
          return HttpResponse.json({ error: 'authorization_pending' });
        }
        return HttpResponse.json(tokenResponse());
      }),
      http.get(USER_URL, () => HttpResponse.json({ login: 'octocat' })),
    );
    const keyring = memoryKeyring();

    await login({ keyring, sleep: noSleep });

    expect(pollCount).toBe(3);
  });

  it('bumps interval on slow_down, keeps polling', async () => {
    let pollCount = 0;
    const sleepCalls: number[] = [];
    server.use(
      http.post(DEVICE_URL, () => HttpResponse.json(deviceResponse({ interval: 5 }))),
      http.post(TOKEN_URL, () => {
        pollCount++;
        if (pollCount === 1) return HttpResponse.json({ error: 'slow_down' });
        return HttpResponse.json(tokenResponse());
      }),
      http.get(USER_URL, () => HttpResponse.json({ login: 'octocat' })),
    );
    const keyring = memoryKeyring();

    await login({
      keyring,
      sleep: (ms) => { sleepCalls.push(ms); return Promise.resolve(); },
    });

    expect(sleepCalls).toEqual([5_000, 10_000]);
  });

  it('throws "denied" when GitHub returns access_denied', async () => {
    server.use(
      http.post(DEVICE_URL, () => HttpResponse.json(deviceResponse())),
      http.post(TOKEN_URL, () => HttpResponse.json({ error: 'access_denied' })),
    );
    const keyring = memoryKeyring();

    await expect(login({ keyring, sleep: noSleep })).rejects.toThrow(/denied/);
    expect(keyring.snapshot()).toBeNull();
  });

  it('throws on expired_token', async () => {
    server.use(
      http.post(DEVICE_URL, () => HttpResponse.json(deviceResponse())),
      http.post(TOKEN_URL, () => HttpResponse.json({ error: 'expired_token' })),
    );
    const keyring = memoryKeyring();

    await expect(login({ keyring, sleep: noSleep })).rejects.toThrow(/expired/);
  });

  it('throws when the device-code request itself fails', async () => {
    server.use(
      http.post(DEVICE_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const keyring = memoryKeyring();

    await expect(login({ keyring, sleep: noSleep })).rejects.toThrow(/device code/);
  });
});

describe('auth.logout', () => {
  it('wipes a stored token', async () => {
    const keyring = memoryKeyring({
      account: 'octocat',
      access_token: 'ghu_x',
      refresh_token: 'ghr_x',
      access_token_expires_at: 2_000_000_000,
      refresh_token_expires_at: 2_500_000_000,
    });

    const result = await logout({ keyring });

    expect(result).toEqual({ wiped: true });
    expect(keyring.snapshot()).toBeNull();
  });

  it('is a no-op when not logged in', async () => {
    const keyring = memoryKeyring();
    const result = await logout({ keyring });
    expect(result).toEqual({ wiped: false });
  });
});

describe('auth.status', () => {
  const validStored: StoredAuth = {
    account: 'octocat',
    access_token: 'ghu_valid',
    refresh_token: 'ghr_valid',
    access_token_expires_at: 2_000_000_000,
    refresh_token_expires_at: 2_500_000_000,
  };

  it('returns not_logged_in when no token stored', async () => {
    const keyring = memoryKeyring();
    const result = await status({ keyring, now: () => 1_000_000 });
    expect(result.authenticated).toBe(false);
    if (result.authenticated) throw new Error('unreachable');
    expect(result.reason).toBe('not_logged_in');
    expect(result.message).toMatch(/auth login/);
  });

  it('returns authenticated when the token validates', async () => {
    server.use(
      http.get(USER_URL, () => HttpResponse.json({ login: 'octocat' })),
    );
    const keyring = memoryKeyring(validStored);

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result).toEqual({
      authenticated: true,
      account: 'octocat',
      expiresAt: 2_000_000_000,
    });
  });

  it('refreshes silently when the access token is near expiry', async () => {
    let userCalls = 0;
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          tokenResponse({ access_token: 'ghu_refreshed', refresh_token: 'ghr_refreshed' }),
        ),
      ),
      http.get(USER_URL, ({ request }) => {
        userCalls++;
        // Only the refreshed token should ever reach the probe.
        expect(request.headers.get('authorization')).toBe('Bearer ghu_refreshed');
        return HttpResponse.json({ login: 'octocat' });
      }),
    );
    const keyring = memoryKeyring({
      ...validStored,
      access_token_expires_at: 1_000_000, // equal to now => refresh
    });

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result.authenticated).toBe(true);
    expect(userCalls).toBe(1);
    expect(keyring.snapshot()?.access_token).toBe('ghu_refreshed');
    expect(keyring.snapshot()?.refresh_token).toBe('ghr_refreshed');
  });

  it('reports refresh_failed when the probe itself returns 5xx', async () => {
    server.use(
      http.get(USER_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const keyring = memoryKeyring(validStored);

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result.authenticated).toBe(false);
    if (result.authenticated) throw new Error('unreachable');
    expect(result.reason).toBe('refresh_failed');
    expect(result.message).toMatch(/\/user probe failed \(500\)/);
  });

  it('reports revoked when 401 → refresh succeeds → re-probe still 401', async () => {
    server.use(
      http.get(USER_URL, () => new HttpResponse(null, { status: 401 })),
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          tokenResponse({ access_token: 'ghu_refreshed', refresh_token: 'ghr_refreshed' }),
        ),
      ),
    );
    const keyring = memoryKeyring(validStored);

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result.authenticated).toBe(false);
    if (result.authenticated) throw new Error('unreachable');
    expect(result.reason).toBe('revoked');
    expect(result.message).toMatch(/rejected/);
  });

  it('reports refresh_failed when the refresh endpoint rejects', async () => {
    server.use(
      http.post(TOKEN_URL, () => new HttpResponse(null, { status: 400 })),
    );
    const keyring = memoryKeyring({
      ...validStored,
      access_token_expires_at: 1_000_000,
    });

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result.authenticated).toBe(false);
    if (result.authenticated) throw new Error('unreachable');
    expect(result.reason).toBe('refresh_failed');
    expect(result.message).toMatch(/Session expired/);
  });

  it('reports revoked when a non-expired token gets 401 and refresh also fails', async () => {
    server.use(
      http.get(USER_URL, () => new HttpResponse(null, { status: 401 })),
      http.post(TOKEN_URL, () => new HttpResponse(null, { status: 400 })),
    );
    const keyring = memoryKeyring(validStored);

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result.authenticated).toBe(false);
    if (result.authenticated) throw new Error('unreachable');
    expect(result.reason).toBe('revoked');
    expect(result.message).toMatch(/rejected/);
  });

  it('recovers from 401 by refreshing and re-probing', async () => {
    let userCalls = 0;
    server.use(
      http.get(USER_URL, ({ request }) => {
        userCalls++;
        const auth = request.headers.get('authorization');
        if (auth === 'Bearer ghu_valid') {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({ login: 'octocat' });
      }),
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          tokenResponse({ access_token: 'ghu_refreshed', refresh_token: 'ghr_refreshed' }),
        ),
      ),
    );
    const keyring = memoryKeyring(validStored);

    const result = await status({ keyring, now: () => 1_000_000 });

    expect(result.authenticated).toBe(true);
    expect(userCalls).toBe(2);
    expect(keyring.snapshot()?.access_token).toBe('ghu_refreshed');
  });
});
