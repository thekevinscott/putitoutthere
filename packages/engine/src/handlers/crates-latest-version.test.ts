import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { cratesLatestVersion } from './crates-latest-version.js';

const ctx = {} as Ctx;

function respond(body: string, status: number): MockInstance<typeof fetch> {
  return vi.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cratesLatestVersion', () => {
  it('reads crate.newest_version from the encoded crate endpoint', async () => {
    const fetchSpy = respond('{"crate":{"newest_version":"1.2.3"}}', 200);
    await expect(cratesLatestVersion({ name: 'x', crate: 'pkg rs' }, ctx)).resolves.toBe('1.2.3');
    expect(fetchSpy).toHaveBeenCalledWith('https://crates.io/api/v1/crates/pkg%20rs', {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
    });
  });

  it('returns null when the body has no newest_version', async () => {
    respond('{}', 200);
    await expect(cratesLatestVersion({ name: 'pkg' }, ctx)).resolves.toBeNull();
  });

  it('returns null when the crate was never published', async () => {
    respond('', 404);
    await expect(cratesLatestVersion({ name: 'pkg' }, ctx)).resolves.toBeNull();
  });

  it('throws a TransientError on any other status', async () => {
    respond('', 500);
    const err = await cratesLatestVersion({ name: 'pkg' }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect((err as Error).message).toBe('crates.io GET https://crates.io/api/v1/crates/pkg returned 500');
  });
});
