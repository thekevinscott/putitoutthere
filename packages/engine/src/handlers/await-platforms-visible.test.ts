import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { awaitPlatformsVisible } from './await-platforms-visible.js';

vi.mock('../utils/sleep.js', () => ({ sleep: vi.fn(() => Promise.resolve()) }));

const fetchMock = vi.fn<typeof fetch>();
const DOC = JSON.stringify({ dist: { tarball: 'https://reg/x.tgz' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('awaitPlatformsVisible', () => {
  it('waits for each per-version document, retrying 404s', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockImplementation(() => Promise.resolve(new Response(DOC, { status: 200 })));
    const stdout = vi.spyOn(process.stdout, 'write');

    await awaitPlatformsVisible(['@s/lib-a', 'lib-b'], '1.2.3', undefined);

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://registry.npmjs.org/@s%2Flib-a/1.2.3',
      'https://registry.npmjs.org/@s%2Flib-a/1.2.3',
      'https://registry.npmjs.org/@s%2Flib-a/1.2.3',
      'https://registry.npmjs.org/lib-b/1.2.3',
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('names the package that never becomes visible', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 })));

    await expect(awaitPlatformsVisible(['lib-a'], '1.2.3', 'http://127.0.0.1:4873/')).rejects.toThrow(
      /lib-a@1\.2\.3 .*not publishing the main package/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:4873/lib-a/1.2.3');
  });
});
