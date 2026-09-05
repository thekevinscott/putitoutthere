/**
 * Wiring test for the single release-metadata read. Mocks the `fetch`
 * boundary, isolating the one distinction that matters (#668): a 404 is
 * reported as `notFound`, and every other failure is not — the caller's whole
 * ability to say "this version is not on TestPyPI" instead of "the index is
 * lagging" rests on it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseReleaseFiles } from './parse-release-files.js';
import { readReleaseFiles } from './read-release-files.js';

vi.mock('./parse-release-files.js');

const parse = vi.mocked(parseReleaseFiles);
const FILES = { wheels: [{ filename: 'x-1.whl', url: 'https://f/x-1.whl' }], sdists: [] };

function response(status: number, body = '{}'): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) } as unknown as Response;
}

function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  vi.resetAllMocks();
  parse.mockReturnValue(FILES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readReleaseFiles', () => {
  it('fetches the given URL and returns the parsed files', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(response(200, '{"urls":[]}')));
    await expect(readReleaseFiles('https://test.pypi.org/pypi/x/1/json')).resolves.toEqual({ files: FILES });
    expect(fetchMock).toHaveBeenCalledWith('https://test.pypi.org/pypi/x/1/json');
    expect(parse).toHaveBeenCalledWith('{"urls":[]}');
  });

  it('reports a 404 as notFound', async () => {
    stubFetch(() => Promise.resolve(response(404)));
    await expect(readReleaseFiles('https://u')).resolves.toEqual({
      failure: { notFound: true, reason: 'HTTP 404' },
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it('reports another error status as a failure that is not notFound', async () => {
    // A 503 means the registry could not answer, which says nothing about
    // whether the version exists — conflating it with 404 would let a
    // transient outage be reported as an unpublished release.
    stubFetch(() => Promise.resolve(response(503)));
    await expect(readReleaseFiles('https://u')).resolves.toEqual({
      failure: { notFound: false, reason: 'HTTP 503' },
    });
  });

  it('reports a transport failure with its message', async () => {
    stubFetch(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));
    await expect(readReleaseFiles('https://u')).resolves.toEqual({
      failure: { notFound: false, reason: 'getaddrinfo ENOTFOUND' },
    });
  });

  it('reports an unparseable 200 body as a failure that is not notFound', async () => {
    parse.mockReturnValue(null);
    stubFetch(() => Promise.resolve(response(200, '<html>')));
    await expect(readReleaseFiles('https://u')).resolves.toEqual({
      failure: { notFound: false, reason: 'unreadable release metadata' },
    });
  });
});
