import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { awaitPlatformsVisible } from './await-platforms-visible.js';

const fetchMock = vi.fn<typeof fetch>();
const stderr: unknown[] = [];
const DOC = JSON.stringify({ dist: { tarball: 'https://reg/x.tgz' } });

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  stderr.length = 0;
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => stderr.push(c) > 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('awaitPlatformsVisible', () => {
  it('waits for each per-version document, retrying 404s', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockImplementation(() => Promise.resolve(new Response(DOC, { status: 200 })));
    const stdout = vi.spyOn(process.stdout, 'write');

    await settle(awaitPlatformsVisible(['@s/lib-a', 'lib-b'], '1.2.3', undefined));

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://registry.npmjs.org/@s%2Flib-a/1.2.3',
      'https://registry.npmjs.org/@s%2Flib-a/1.2.3',
      'https://registry.npmjs.org/@s%2Flib-a/1.2.3',
      'https://registry.npmjs.org/lib-b/1.2.3',
    ]);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toEqual([
      '  https://registry.npmjs.org/@s%2Flib-a/1.2.3 not readable yet (attempt 1/8); retrying in 5s\n',
      '  https://registry.npmjs.org/@s%2Flib-a/1.2.3 not readable yet (attempt 2/8); retrying in 15s\n',
    ]);
  });

  it('names the package that never becomes visible', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 })));

    const result = awaitPlatformsVisible(['lib-a'], '1.2.3', 'http://127.0.0.1:4873/');
    const settled = expect(result).rejects.toThrow(
      /lib-a@1\.2\.3 .*not publishing the main package/,
    );
    await vi.runAllTimersAsync();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:4873/lib-a/1.2.3');
  });
});
