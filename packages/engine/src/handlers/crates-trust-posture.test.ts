import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { cratesTrustPosture } from './crates-trust-posture.js';

const ctx = {} as Ctx;
const url = 'https://crates.io/api/v1/crates/pkg%20rs/1.0.0%2Bb';

function respond(body: string, status: number): MockInstance<typeof fetch> {
  return vi.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cratesTrustPosture', () => {
  it('reads trustpub_data as oidc from the encoded version endpoint', async () => {
    const fetchSpy = respond('{"version":{"trustpub_data":{"provider":"github"}}}', 200);
    await expect(cratesTrustPosture({ name: 'x', crate: 'pkg rs' }, '1.0.0+b', ctx)).resolves.toBe('oidc');
    expect(fetchSpy).toHaveBeenCalledWith(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  });

  it('reads a null trustpub_data as token', async () => {
    respond('{"version":{"trustpub_data":null}}', 200);
    await expect(cratesTrustPosture({ name: 'pkg' }, '1.0.0', ctx)).resolves.toBe('token');
  });

  it('reads a body without a version as token', async () => {
    respond('{}', 200);
    await expect(cratesTrustPosture({ name: 'pkg' }, '1.0.0', ctx)).resolves.toBe('token');
  });

  it('throws a TransientError on any non-200 status', async () => {
    respond('', 404);
    const err = await cratesTrustPosture({ name: 'x', crate: 'pkg rs' }, '1.0.0+b', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe(`crates.io GET ${url} returned 404`);
  });
});
