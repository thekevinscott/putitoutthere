import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { cratesIsPublished } from './crates-is-published.js';

const ctx = {} as Ctx;
const pkg = { name: 'pkg', crate: 'pkg rs' };
const url = 'https://crates.io/api/v1/crates/pkg%20rs/1.0.0%2Bb';

function respond(status: number): MockInstance<typeof fetch> {
  return vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cratesIsPublished', () => {
  it('GETs the encoded version endpoint and reads 200 as published', async () => {
    const fetchSpy = respond(200);
    await expect(cratesIsPublished(pkg, '1.0.0+b', ctx)).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  });

  it('reads 404 as unpublished', async () => {
    respond(404);
    await expect(cratesIsPublished(pkg, '1.0.0+b', ctx)).resolves.toBe(false);
  });

  it.each([429, 500, 503])('throws a TransientError on %i', async (status) => {
    respond(status);
    const err = await cratesIsPublished(pkg, '1.0.0+b', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe(`crates.io GET ${url} returned ${status}`);
  });

  it.each([400, 403, 499])('throws a hard error on %i', async (status) => {
    respond(status);
    const err = await cratesIsPublished(pkg, '1.0.0+b', ctx).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe(`crates.io GET ${url} returned ${status}`);
  });
});
