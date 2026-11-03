import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveNpmTarballUrl } from './resolve-url.js';

const fetchMock = vi.fn<typeof fetch>();
const out: string[] = [];

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const DOC = { dist: { tarball: 'https://reg/pkg.tgz' } };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe('resolveNpmTarballUrl', () => {
  it('reads the per-version document for a scoped name on public npm', async () => {
    fetchMock.mockResolvedValue(respond(200, DOC));
    expect(await resolveNpmTarballUrl('@scope/pkg', '1.0.0', { sleeps: [1] })).toBe('https://reg/pkg.tgz');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://registry.npmjs.org/@scope%2Fpkg/1.0.0');
    expect(fetchMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    expect(out.join('')).toBe('');
  });

  it('reads from an override registry, trailing slash and all', async () => {
    fetchMock.mockResolvedValue(respond(200, DOC));
    await resolveNpmTarballUrl('pkg', '1.0.0', { registry: 'http://localhost:4873/', sleeps: [] });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:4873/pkg/1.0.0');
  });

  it('retries a 404 until the version appears', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(respond(404, DOC)).mockResolvedValue(respond(200, DOC));
    expect(await settle(resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [3] }))).toBe('https://reg/pkg.tgz');
    expect(out.join('')).toBe('  https://registry.npmjs.org/pkg/1.0.0 not readable yet (attempt 1/2); retrying in 3s\n');
  });

  it('sends retry lines to the given log instead of stdout', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    fetchMock.mockResolvedValueOnce(respond(404, DOC)).mockResolvedValue(respond(200, DOC));
    await settle(resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [3], log: (l) => lines.push(l) }));
    expect(lines).toEqual(['  https://registry.npmjs.org/pkg/1.0.0 not readable yet (attempt 1/2); retrying in 3s\n']);
    expect(out.join('')).toBe('');
  });

  it('gives up with null once every attempt fails', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(respond(200, {}));
    expect(await settle(resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1, 1] }))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps polling at the last interval until the deadline, then gives up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    fetchMock.mockResolvedValue(respond(404, DOC));
    const start = Date.now();
    const p = resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1, 4], deadline: start + 10_000 });
    expect(await settle(p)).toBeNull();
    expect(Date.now() - start).toBe(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(out.join('')).toContain('(attempt 4); retrying in 1s\n');
  });

  it('resolves past the schedule while the deadline still allows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    fetchMock
      .mockResolvedValueOnce(respond(404, DOC))
      .mockResolvedValueOnce(respond(404, DOC))
      .mockResolvedValueOnce(respond(404, DOC))
      .mockResolvedValue(respond(200, DOC));
    const p = resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1], deadline: Date.now() + 60_000 });
    expect(await settle(p)).toBe('https://reg/pkg.tgz');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('gives up after one attempt when the deadline has already passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    fetchMock.mockResolvedValue(respond(404, DOC));
    expect(await settle(resolveNpmTarballUrl('pkg', '1.0.0', { sleeps: [1], deadline: Date.now() }))).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
