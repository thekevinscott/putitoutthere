import { describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { pypiIsPublished } from './pypi-is-published.js';

vi.mock('./pypi-name-for.js', async () => await vi.importActual<typeof import('./pypi-name-for.js')>('./pypi-name-for.js'));

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: '.',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
    ...over,
  };
}

function basePkg(over: Partial<{ name: string; pypi?: string }> = {}): { name: string; pypi?: string } {
  return { name: 'demo-python', pypi: 'demo-pkg', ...over };
}

describe('pypiIsPublished', () => {
  it('returns true on 200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    expect(await pypiIsPublished(basePkg(), '0.1.0', makeCtx())).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-pkg/0.1.0/json',
      { method: 'GET', headers: { 'user-agent': expect.stringMatching(/^putitoutthere\//) as string } },
    );
    fetchSpy.mockRestore();
  });

  it('returns false on 404', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }),
    );
    expect(await pypiIsPublished(basePkg(), '9.9.9', makeCtx())).toBe(false);
    fetchSpy.mockRestore();
  });

  it('falls back to package.name when no pypi field', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    await pypiIsPublished(basePkg({ pypi: undefined as unknown as string }), '0.1.0', makeCtx());
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-python/0.1.0/json',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx (500 boundary) so the check retries', async () => {
    // Use the exact 500 boundary and assert the error TYPE (name), not just a
    // status substring: a plain Error whose message merely contains "500"
    // would pass a message regex, so it could not distinguish the `>= 500`
    // transient branch from the plain-Error fallthrough (nor a `>= 500` →
    // `> 500` off-by-one). `.name === 'TransientError'` pins the retryable
    // contract at the boundary.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    const err = await pypiIsPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('TransientError');
    expect((err as Error).message).toMatch(/returned 500/);
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 429 so the rate-limited GET retries (#580)', async () => {
    // PyPI rate-limits routine reads. A 429 is not >= 500, so it used to hit
    // the plain-Error fallthrough, which carries no `status` and is therefore
    // NOT retried by withRetry — hard-failing the publish. It must surface as
    // a TransientError (which withRetry keys on) so the check retries.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    // TransientError sets `name = 'TransientError'`; assert on the name rather
    // than importing the class as a value (which would trip the unit-suite's
    // unmocked-collaborator isolation gate). withRetry keys on the class via
    // instanceof — the retry integration test proves the real retry path.
    const err = await pypiIsPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('TransientError');
    fetchSpy.mockRestore();
  });

  it('throws a non-transient error on an unexpected 4xx (not 404)', async () => {
    // The endpoint contract is 200/404, but a 4xx like 403 (not 429) must
    // surface a hard (non-retryable) error (name 'Error', NOT 'TransientError')
    // rather than be misread as "not published" or retried indefinitely.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    );
    const err = await pypiIsPublished(basePkg(), '0.1.0', makeCtx())
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('Error');
    expect((err as Error).message).toMatch(/403/);
    fetchSpy.mockRestore();
  });
});
