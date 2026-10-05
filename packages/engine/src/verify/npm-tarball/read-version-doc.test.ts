import { afterEach, describe, expect, it, vi } from 'vitest';

import { readNpmVersionDoc } from './read-version-doc.js';
import { USER_AGENT } from '../../version.js';

// The options-form `{ spy: true }` mock (not a factory) intercepts the module
// for unit isolation while passing the real value through: the assertion below
// is that the read sends the engine's OWN user-agent, which a stubbed constant
// would not pin.
vi.mock('../../version.js', { spy: true });

const DOC = 'https://registry.npmjs.org/@scope%2Fpkg/1.0.0';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readNpmVersionDoc', () => {
  it('returns the document dist.tarball, read as a bounded GET', async () => {
    // `fetch` is a global, not a first-party module, so it is spied per the
    // unit-lint isolation convention; real registry reads are the e2e tier's.
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(json({ dist: { tarball: 'https://reg/pkg.tgz' } }, 200));

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'found', tarball: 'https://reg/pkg.tgz' });
    // Unauthenticated and time-boxed: a hung registry has to become a
    // retryable failure rather than a job that never ends.
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(DOC);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({ 'user-agent': USER_AGENT, accept: 'application/json' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('calls a 404 missing — the document is written at publish time', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('"version not found: 1.0.0"', { status: 404 }),
    );

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'missing' });
  });

  it('reports a 200 with no dist at all as untarballed, not as a crash', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({}, 200));

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'untarballed' });
  });

  it('reports an empty dist.tarball as untarballed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ dist: { tarball: '' } }, 200));

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'untarballed' });
  });

  it('reports any other status as unreadable, naming the status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'unreadable', detail: 'HTTP 503' });
  });

  it('reports a transport failure as unreadable, with the error message', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'unreadable', detail: 'ECONNRESET' });
  });

  it('stringifies a non-Error rejection rather than reading .message off it', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('socket hang up');

    expect(await readNpmVersionDoc(DOC)).toEqual({ status: 'unreadable', detail: 'socket hang up' });
  });

  it('reports a 200 that is not JSON as unreadable', async () => {
    // A CDN error page served with a 200 is a read that did not complete, so
    // it belongs with the retryable failures, not with "never published".
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('<html>502</html>', { status: 200 }));

    expect((await readNpmVersionDoc(DOC)).status).toBe('unreadable');
  });
});
