import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TransientError, type Ctx } from '../types.js';
import { npmTrustPosture } from './npm-trust-posture.js';

vi.mock('../types.js', async () => await vi.importActual<typeof import('../types.js')>('../types.js'));
vi.mock('../version.js', async () => ({
  ...(await vi.importActual<typeof import('../version.js')>('../version.js')),
  USER_AGENT: 'piot-test-agent',
}));
vi.mock('./npm-name-for.js', async () => await vi.importActual<typeof import('./npm-name-for.js')>('./npm-name-for.js'));

const ctx = {} as Ctx;
const pkg = { name: 'demo-js', path: '.', npm: 'demo-npm' };
const url = 'https://registry.npmjs.org/-/npm/v1/attestations/demo-npm@0.1.0';

function respond(status: number): MockInstance<typeof fetch> {
  return vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('npmTrustPosture', () => {
  it('oidc when the provenance attestations endpoint returns 200', async () => {
    const spy = respond(200);
    expect(await npmTrustPosture(pkg, '0.1.0', ctx)).toBe('oidc');
    expect(spy).toHaveBeenCalledWith(url, { method: 'GET', headers: { 'user-agent': 'piot-test-agent' } });
  });

  it('token when the attestations endpoint returns 404', async () => {
    respond(404);
    expect(await npmTrustPosture(pkg, '0.1.0', ctx)).toBe('token');
  });

  it('throws a TransientError on a registry error', async () => {
    respond(503);
    const err = await npmTrustPosture(pkg, '0.1.0', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe(`registry.npmjs.org GET ${url} returned 503`);
  });
});
