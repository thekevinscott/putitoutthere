import { describe, expect, it, vi } from 'vitest';

import { isBootstrapPublish } from './is-bootstrap-publish.js';

describe('isBootstrapPublish', () => {
  it('unscoped names hit /<name> on the registry', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    expect(await isBootstrapPublish('demo-npm')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://registry.npmjs.org/demo-npm',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('scoped names keep `@`, encode `/`', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    await isBootstrapPublish('@scope/name');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@scope%2Fname',
      expect.any(Object) as object,
    );
    fetchSpy.mockRestore();
  });

  it('200 means package exists, not a bootstrap case', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"name":"demo-npm"}', { status: 200 }),
    );
    expect(await isBootstrapPublish('demo-npm')).toBe(false);
    fetchSpy.mockRestore();
  });

  it('passes a 5s AbortSignal.timeout (#142)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    await isBootstrapPublish('demo-npm');
    const call = fetchSpy.mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // AbortSignal.timeout signals aren't aborted at construction time.
    expect(init.signal!.aborted).toBe(false);
    fetchSpy.mockRestore();
  });

  it('timeout/network error falls through to false (#142)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      ),
    );
    expect(await isBootstrapPublish('demo-npm')).toBe(false);
    fetchSpy.mockRestore();
  });
});
