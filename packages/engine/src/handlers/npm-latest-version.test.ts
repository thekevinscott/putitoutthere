import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { npmLatestVersion } from './npm-latest-version.js';

const ctx = {} as Ctx;

function respond(body: string, status: number): MockInstance<typeof fetch> {
  return vi.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('npmLatestVersion', () => {
  it('reads dist-tags.latest from the scoped packument', async () => {
    const fetchSpy = respond('{"dist-tags":{"latest":"1.2.3"}}', 200);
    await expect(npmLatestVersion({ name: 'x', path: '.', npm: '@s/pkg' }, ctx)).resolves.toBe('1.2.3');
    expect(fetchSpy).toHaveBeenCalledWith('https://registry.npmjs.org/@s%2Fpkg', {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
    });
  });

  it('returns null when the packument has no latest tag', async () => {
    respond('{}', 200);
    await expect(npmLatestVersion({ name: 'pkg', path: '.' }, ctx)).resolves.toBeNull();
  });

  it('returns null when the package was never published', async () => {
    respond('', 404);
    await expect(npmLatestVersion({ name: 'pkg', path: '.' }, ctx)).resolves.toBeNull();
  });

  it('throws a TransientError on any other status', async () => {
    respond('', 503);
    const err = await npmLatestVersion({ name: 'pkg', path: '.' }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe('registry.npmjs.org GET https://registry.npmjs.org/pkg returned 503');
  });
});
