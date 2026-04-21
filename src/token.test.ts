/**
 * Unit tests for `src/token.ts`.
 *
 * Covers detection + PyPI macaroon decoding (#107), npm live probe (#108),
 * and crates.io live probe (#109). Live probes are mocked with msw; no
 * real network access.
 */

import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { detectRegistry, inspect, isError, tokenList } from './token.js';
import type {
  CratesInspectResult,
  NpmInspectResult,
  PypiInspectResult,
  InspectResult,
} from './token.js';
import type { Package } from './config.js';

const NPM_BASE = 'https://npm.test';
const CRATES_BASE = 'https://crates.test';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Build a synthetic PyPI token whose base64 payload contains the given
 * JSON blobs in order. The real macaroon envelope surrounds these
 * blobs with binary header bytes; our JSON-scanner ignores them, so
 * inserting arbitrary binary separators is representative.
 */
function buildPypiToken(identifier: object, caveats: object[]): string {
  const parts = [
    Buffer.from([0x02]), // v2 version byte
    Buffer.from(JSON.stringify(identifier), 'utf8'),
  ];
  for (const c of caveats) {
    parts.push(Buffer.from([0x00, 0x01])); // arbitrary separator bytes
    parts.push(Buffer.from(JSON.stringify(c), 'utf8'));
  }
  parts.push(Buffer.from([0x04, 0x00])); // fake signature marker
  return 'pypi-' + Buffer.concat(parts).toString('base64');
}

function asPypi(r: InspectResult): PypiInspectResult {
  if (isError(r)) throw new Error(`expected success; got error: ${r.error}`);
  if (r.registry !== 'pypi') throw new Error(`expected pypi; got ${r.registry}`);
  return r;
}

function asNpm(r: InspectResult): NpmInspectResult {
  if (isError(r)) throw new Error(`expected success; got error: ${r.error}`);
  if (r.registry !== 'npm') throw new Error(`expected npm; got ${r.registry}`);
  return r;
}

function asCrates(r: InspectResult): CratesInspectResult {
  if (isError(r)) throw new Error(`expected success; got error: ${r.error}`);
  if (r.registry !== 'crates') throw new Error(`expected crates; got ${r.registry}`);
  return r;
}

describe('detectRegistry', () => {
  it('detects pypi tokens by prefix', () => {
    expect(detectRegistry('pypi-deadbeef')).toBe('pypi');
  });

  it('detects npm tokens by prefix', () => {
    expect(detectRegistry('npm_abc123')).toBe('npm');
  });

  it('falls back to crates for opaque tokens', () => {
    expect(detectRegistry('ci0abcdef0123456789')).toBe('crates');
  });
});

describe('inspect — PyPI', () => {
  it('decodes a user-scoped token', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.format).toBe('macaroon');
    expect(r.identifier).toEqual({ version: 1, permissions: 'user', user: 'u-abc' });
    expect(r.restrictions).toEqual([]);
    expect(r.expired).toBe(false);
    expect(r.source_digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('decodes a v2-style project-names caveat', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ version: 1, projects: ['pkg-a', 'pkg-b'] }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectNames', names: ['pkg-a', 'pkg-b'] },
    ]);
  });

  it('decodes a legacy v1-shape permissions caveat', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ permissions: { projects: ['legacy-pkg'] }, version: 1 }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectNames', names: ['legacy-pkg'] },
    ]);
  });

  it('decodes a project-ids caveat', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ version: 2, project_ids: ['id-1', 'id-2'] }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectIDs', ids: ['id-1', 'id-2'] },
    ]);
  });

  it('decodes a date restriction (nbf/exp shape)', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ nbf: 1000, exp: 2000 }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'Date', not_before: 1000, not_after: 2000 },
    ]);
  });

  it('decodes a date restriction (not_before/not_after shape)', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ not_before: 500, not_after: 1500 }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'Date', not_before: 500, not_after: 1500 },
    ]);
  });

  it('marks expired=true when not_after is in the past', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ not_after: 1 }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.expired).toBe(true);
  });

  it('marks expired=false for a far-future expiry', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ not_after: 9_999_999_999 }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.expired).toBe(false);
  });

  it('preserves unknown caveat shapes as Unknown', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ something_new: 'whatever', count: 3 }],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'Unknown', raw: { something_new: 'whatever', count: 3 } },
    ]);
  });

  it('decodes multiple caveats in order', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [
        { version: 1, projects: ['a'] },
        { not_before: 0, not_after: 9_999_999_999 },
      ],
    );
    const r = asPypi(await inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectNames', names: ['a'] },
      { type: 'Date', not_before: 0, not_after: 9_999_999_999 },
    ]);
  });

  it('tolerates JSON containing braces inside strings', async () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc', note: 'has { and } in it' },
      [],
    );
    const r = asPypi(await inspect({ token }));
    expect((r.identifier as Record<string, unknown>).note).toBe('has { and } in it');
  });

  it('errors on a token missing the pypi- prefix when --registry=pypi', async () => {
    const r = await inspect({ token: 'not-pypi-token', registry: 'pypi' });
    expect(isError(r) ? r.error : '').toMatch(/pypi-/);
  });

  it('errors on base64 that decodes to no JSON', async () => {
    const token = 'pypi-' + Buffer.from('no json here just bytes').toString('base64');
    const r = await inspect({ token });
    expect(isError(r)).toBe(true);
  });

  it('errors on an empty base64 body', async () => {
    const r = await inspect({ token: 'pypi-' });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toMatch(/base64/);
  });

  it('decodes an unpadded base64 body', async () => {
    // Drop trailing '=' padding — some PyPI serializers have emitted
    // both padded and unpadded bodies historically.
    const padded = buildPypiToken({ version: 1, permissions: 'user', user: 'u-abc' }, []);
    const stripped = 'pypi-' + padded.slice('pypi-'.length).replace(/=+$/, '');
    const r = asPypi(await inspect({ token: stripped }));
    expect((r.identifier as Record<string, unknown>).user).toBe('u-abc');
  });

  it('ignores braces that do not form valid JSON and finds real objects after them', async () => {
    const real = JSON.stringify({ version: 1, user: 'u' });
    const junk = '{ not json at all } {also not}';
    const payload = Buffer.concat([Buffer.from(junk), Buffer.from([0x00]), Buffer.from(real)]);
    const token = 'pypi-' + payload.toString('base64');
    const r = asPypi(await inspect({ token }));
    expect(r.identifier).toEqual({ version: 1, user: 'u' });
  });

  it('tolerates backslash-escaped characters inside JSON strings', async () => {
    const identifier = { version: 1, note: 'line\\nbreak "quoted"' };
    const payload = Buffer.from(JSON.stringify(identifier));
    const token = 'pypi-' + payload.toString('base64');
    const r = asPypi(await inspect({ token }));
    expect((r.identifier as Record<string, unknown>).note).toBe('line\\nbreak "quoted"');
  });

  it('skips a lone open brace with no matching close and continues scanning', async () => {
    // A `{` with no matching `}` should be walked past; findMatchingBrace returns -1.
    // Then a valid JSON object follows.
    const buf = Buffer.concat([
      Buffer.from('{ no closer here ever '),
      Buffer.from(JSON.stringify({ version: 1, user: 'u-late' })),
    ]);
    const token = 'pypi-' + buf.toString('base64');
    const r = asPypi(await inspect({ token }));
    expect(r.identifier).toEqual({ version: 1, user: 'u-late' });
  });

  it('computes a stable sha256 digest prefix', async () => {
    const token = buildPypiToken({ version: 1 }, []);
    const r1 = await inspect({ token });
    const r2 = await inspect({ token });
    expect(r1.source_digest).toBe(r2.source_digest);
  });
});

describe('inspect — npm live probe', () => {
  it('happy path: whoami + SHA-512 match returns scope_row', async () => {
    const token = 'npm_' + 'a'.repeat(36);
    const key = createHash('sha512').update(token).digest('hex');
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'alice' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, () =>
        HttpResponse.json({
          objects: [
            {
              key: 'different',
              readonly: false,
              automation: false,
              cidr_whitelist: null,
              created: '2026-01-01T00:00:00Z',
            },
            {
              key,
              readonly: false,
              automation: true,
              scopes: ['pkg:@alice/pkg-a', '@alice', 'org:alice-org'],
              cidr_whitelist: ['10.0.0.0/8'],
              created: '2026-01-10T00:00:00Z',
              expires: '2026-12-01T00:00:00Z',
            },
          ],
        }),
      ),
    );
    const r = asNpm(await inspect({ token, baseUrl: NPM_BASE }));
    expect(r.username).toBe('alice');
    expect(r.format).toBe('granular');
    expect(r.scope_row).not.toBeNull();
    expect(r.scope_row!.automation).toBe(true);
    expect(r.scope_row!.readonly).toBe(false);
    expect(r.scope_row!.packages).toEqual(['@alice/pkg-a']);
    expect(r.scope_row!.scopes).toEqual(['@alice']);
    expect(r.scope_row!.orgs).toEqual(['alice-org']);
    expect(r.scope_row!.expires_at).toBe('2026-12-01T00:00:00Z');
    expect(r.scope_row!.cidr_whitelist).toEqual(['10.0.0.0/8']);
  });

  it('401 on whoami returns error', async () => {
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () =>
        new HttpResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      ),
    );
    const r = await inspect({ token: 'npm_bad', baseUrl: NPM_BASE });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toMatch(/invalid or expired/);
  });

  it('403 on tokens endpoint degrades to partial result', async () => {
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'bob' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, () =>
        new HttpResponse(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
      ),
    );
    const r = asNpm(await inspect({ token: 'npm_narrow', baseUrl: NPM_BASE }));
    expect(r.username).toBe('bob');
    expect(r.scope_row).toBeNull();
    expect(r.note).toMatch(/403/);
  });

  it('no matching SHA-512 row emits partial result with note', async () => {
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'carol' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, () =>
        HttpResponse.json({ objects: [{ key: 'other', readonly: true }] }),
      ),
    );
    const r = asNpm(await inspect({ token: 'npm_legacy', baseUrl: NPM_BASE }));
    expect(r.scope_row).toBeNull();
    expect(r.note).toMatch(/no SHA-512 match/);
  });

  it('timeout returns timeout error', async () => {
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ username: 'x' });
      }),
    );
    const r = await inspect({ token: 'npm_slow', baseUrl: NPM_BASE, timeoutMs: 10 });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toBe('timeout');
  });

  it('timeout on tokens endpoint after whoami success returns timeout', async () => {
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'dan' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ objects: [] });
      }),
    );
    const r = await inspect({ token: 'npm_tokenslow', baseUrl: NPM_BASE, timeoutMs: 30 });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toBe('timeout');
  });

  it('treats --registry=npm override on a legacy-shaped token as legacy format', async () => {
    const token = 'deadbeef-legacy-uuid';
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'zed' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, () =>
        HttpResponse.json({ objects: [{ key: 'nope' }] }),
      ),
    );
    const r = asNpm(
      await inspect({ token, registry: 'npm', baseUrl: NPM_BASE }),
    );
    expect(r.format).toBe('legacy');
  });

  it('handles an unexpected body shape on the tokens endpoint', async () => {
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'weird' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, () =>
        HttpResponse.json({ error: 'something unexpected' }),
      ),
    );
    const r = asNpm(await inspect({ token: 'npm_weird', baseUrl: NPM_BASE }));
    expect(r.scope_row).toBeNull();
    expect(r.note).toMatch(/no SHA-512 match/);
  });

  it('accepts a bare array response from the tokens endpoint', async () => {
    const token = 'npm_' + 'b'.repeat(36);
    const key = createHash('sha512').update(token).digest('hex');
    server.use(
      http.get(`${NPM_BASE}/-/whoami`, () => HttpResponse.json({ username: 'flat' })),
      http.get(`${NPM_BASE}/-/npm/v1/tokens`, () =>
        HttpResponse.json([{ key, readonly: true }]),
      ),
    );
    const r = asNpm(await inspect({ token, baseUrl: NPM_BASE }));
    expect(r.scope_row?.readonly).toBe(true);
    expect(r.scope_row?.scopes).toBeNull();
    expect(r.scope_row?.packages).toBeNull();
    expect(r.scope_row?.orgs).toBeNull();
    expect(r.scope_row?.cidr_whitelist).toBeNull();
    expect(r.scope_row?.created).toBeNull();
    expect(r.scope_row?.expires_at).toBeNull();
  });

});

describe('inspect — crates.io live probe', () => {
  it('happy path: /me + /me/tokens returns username and token list', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: { login: 'dave' } }),
      ),
      http.get(`${CRATES_BASE}/api/v1/me/tokens`, () =>
        HttpResponse.json({
          api_tokens: [
            {
              name: 'ci',
              endpoint_scopes: ['publish-update'],
              crate_scopes: ['my-lib*'],
              expired_at: null,
            },
            {
              name: 'laptop',
              endpoint_scopes: null,
              crate_scopes: null,
              expired_at: null,
            },
          ],
        }),
      ),
    );
    const r = asCrates(await inspect({ token: 'cio-raw-token', baseUrl: CRATES_BASE }));
    expect(r.username).toBe('dave');
    expect(r.account_tokens).toHaveLength(2);
    expect(r.account_tokens![0]).toEqual({
      name: 'ci',
      endpoint_scopes: ['publish-update'],
      crate_scopes: ['my-lib*'],
      expired_at: null,
    });
    expect(r.bearer_row).toBeNull();
    expect(r.note).toMatch(/does not expose/);
  });

  it('401 on /me returns error', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        new HttpResponse(JSON.stringify({ errors: [{ detail: 'unauthorized' }] }), { status: 401 }),
      ),
    );
    const r = await inspect({ token: 'bad', baseUrl: CRATES_BASE });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toMatch(/invalid or expired/);
  });

  it('403 on /me/tokens degrades to partial result', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: { login: 'eve' } }),
      ),
      http.get(`${CRATES_BASE}/api/v1/me/tokens`, () =>
        new HttpResponse(JSON.stringify({ errors: [{ detail: 'forbidden' }] }), { status: 403 }),
      ),
    );
    const r = asCrates(await inspect({ token: 'narrow', baseUrl: CRATES_BASE }));
    expect(r.username).toBe('eve');
    expect(r.account_tokens).toBeNull();
    expect(r.note).toMatch(/403/);
  });

  it('timeout returns timeout error', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ user: { login: 'x' } });
      }),
    );
    const r = await inspect({ token: 'slow', baseUrl: CRATES_BASE, timeoutMs: 10 });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toBe('timeout');
  });

  it('honors an explicit --registry=crates override for npm_-prefixed tokens', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: { login: 'frank' } }),
      ),
      http.get(`${CRATES_BASE}/api/v1/me/tokens`, () =>
        HttpResponse.json({ api_tokens: [] }),
      ),
    );
    const r = await inspect({ token: 'npm_looking', registry: 'crates', baseUrl: CRATES_BASE });
    expect(r.registry).toBe('crates');
  });

  it('timeout on tokens endpoint after /me success returns timeout', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: { login: 'gina' } }),
      ),
      http.get(`${CRATES_BASE}/api/v1/me/tokens`, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ api_tokens: [] });
      }),
    );
    const r = await inspect({ token: 'raw', baseUrl: CRATES_BASE, timeoutMs: 30 });
    expect(isError(r)).toBe(true);
    if (isError(r)) expect(r.error).toBe('timeout');
  });

  it('skips non-object entries in api_tokens and fills defaults for sparse rows', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: { login: 'hank' } }),
      ),
      http.get(`${CRATES_BASE}/api/v1/me/tokens`, () =>
        HttpResponse.json({
          api_tokens: [
            'not-an-object',
            { name: 'ok' },
            {}, // unnamed row → falls through to '(unnamed)'
            { name: 'expiring', expired_at: '2027-01-01T00:00:00Z' },
          ],
        }),
      ),
    );
    const r = asCrates(await inspect({ token: 'raw2', baseUrl: CRATES_BASE }));
    expect(r.account_tokens).toHaveLength(3);
    expect(r.account_tokens![0]!.name).toBe('ok');
    expect(r.account_tokens![0]!.endpoint_scopes).toBeNull();
    expect(r.account_tokens![0]!.crate_scopes).toBeNull();
    expect(r.account_tokens![1]!.name).toBe('(unnamed)');
    expect(r.account_tokens![2]!.expired_at).toBe('2027-01-01T00:00:00Z');
  });

  it('emits empty account_tokens when /me/tokens body has no api_tokens field', async () => {
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: { login: 'iris' } }),
      ),
      http.get(`${CRATES_BASE}/api/v1/me/tokens`, () =>
        HttpResponse.json({ unrelated: 'shape' }),
      ),
    );
    const r = asCrates(await inspect({ token: 'raw3', baseUrl: CRATES_BASE }));
    expect(r.account_tokens).toEqual([]);
  });

  it('reports "invalid or expired" when /me body lacks a user field', async () => {
    // This exercises the extractCratesUsername null path. crates.io API would never
    // reply 200 without a user field, but if it ever did we want to fail closed.
    server.use(
      http.get(`${CRATES_BASE}/api/v1/me`, () =>
        HttpResponse.json({ user: {} }),
      ),
    );
    const r = await inspect({ token: 'raw4', baseUrl: CRATES_BASE });
    expect(isError(r)).toBe(true);
  });
});

describe('tokenList', () => {
  const pypiPkg: Package = {
    kind: 'pypi',
    name: 'my-pypi',
    path: 'packages/py',
    paths: ['packages/py/**'],
    depends_on: [],
    first_version: '0.1.0',
  };
  const npmPkg: Package = {
    kind: 'npm',
    name: 'my-npm',
    path: 'packages/node',
    paths: ['packages/node/**'],
    depends_on: [],
    first_version: '0.1.0',
  };
  const cratesPkg: Package = {
    kind: 'crates',
    name: 'my-crate',
    path: 'crates/core',
    paths: ['crates/core/**'],
    depends_on: [],
    first_version: '0.1.0',
  };

  it('classifies pypi- and npm_ prefixed values regardless of config', () => {
    const rows = tokenList({
      packages: [],
      env: {
        TWINE_PASSWORD: 'pypi-AgEIcHlwaS5vcmc=',
        NPM_TOKEN: 'npm_abcdefghijklmnopqrstuvwxyz012345',
        UNRELATED: 'hello world',
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === 'TWINE_PASSWORD')).toMatchObject({
      registry: 'pypi',
      source: 'env',
      details: 'pypi- prefix, macaroon',
    });
    expect(rows.find((r) => r.name === 'NPM_TOKEN')).toMatchObject({
      registry: 'npm',
      source: 'env',
      details: 'npm_ prefix (granular)',
    });
  });

  it('classifies an opaque CARGO_REGISTRY_TOKEN only when config has a crates package', () => {
    const rowsNoCrates = tokenList({
      packages: [pypiPkg, npmPkg],
      env: { CARGO_REGISTRY_TOKEN: 'cio00000000000000000000000000000000000' },
    });
    expect(rowsNoCrates).toHaveLength(0);

    const rowsWithCrates = tokenList({
      packages: [cratesPkg],
      env: { CARGO_REGISTRY_TOKEN: 'cio00000000000000000000000000000000000' },
    });
    expect(rowsWithCrates).toEqual([
      {
        registry: 'crates',
        source: 'env',
        name: 'CARGO_REGISTRY_TOKEN',
        details: 'opaque (from config)',
      },
    ]);
  });

  it('ignores unmatched and empty values', () => {
    const rows = tokenList({
      packages: [cratesPkg, pypiPkg, npmPkg],
      env: {
        HOME: '/home/user',
        PATH: '/usr/bin',
        EMPTY: '   ',
        UNDEF_LIKE: '',
        OPAQUE_RANDOM: 'some-api-key-but-wrong-env-name',
      },
    });
    expect(rows).toHaveLength(0);
  });

  it('sorts rows by registry then env var name', () => {
    const rows = tokenList({
      packages: [cratesPkg],
      env: {
        Z_TWINE: 'pypi-xyz',
        A_TWINE: 'pypi-abc',
        CARGO_REGISTRY_TOKEN: 'cio00000',
      },
    });
    expect(rows.map((r) => r.name)).toEqual(['CARGO_REGISTRY_TOKEN', 'A_TWINE', 'Z_TWINE']);
  });

  it('never surfaces token values', () => {
    const secret = 'pypi-SUPER-SECRET-VALUE';
    const rows = tokenList({
      packages: [],
      env: { TWINE_PASSWORD: secret },
    });
    for (const r of rows) {
      for (const v of Object.values(r)) {
        expect(String(v)).not.toContain(secret);
        expect(String(v)).not.toContain('SUPER-SECRET-VALUE');
      }
    }
  });

  it('falls back to env-only classification when config cannot be loaded', () => {
    // No packages passed, no valid config → hasCrates = false. Prefix-based
    // tokens still classify; opaque crates env var is ignored.
    const rows = tokenList({
      configPath: '/nonexistent/path/does-not-exist.toml',
      env: {
        TWINE_PASSWORD: 'pypi-something',
        CARGO_REGISTRY_TOKEN: 'opaque',
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.registry).toBe('pypi');
  });
});
