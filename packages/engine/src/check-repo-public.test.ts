import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { checkRepoPublic } from './check-repo-public.js';
import { normalizeOwnerRepo } from './normalize-owner-repo.js';

vi.mock('./normalize-owner-repo.js');

const normalizeMock = vi.mocked(normalizeOwnerRepo);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchReturning(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(() => Promise.resolve(jsonResponse(status, body)));
}

function requestInit(fetchImpl: ReturnType<typeof vi.fn>): RequestInit {
  return fetchImpl.mock.calls[0]![1] as RequestInit;
}

let stdout: MockInstance<typeof process.stdout.write>;

beforeEach(() => {
  normalizeMock.mockReset();
  normalizeMock.mockReturnValue('acme/widget');
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdout.mockRestore();
});

describe('checkRepoPublic', () => {
  it('returns null when the GitHub API reports the repo as public', async () => {
    const fetchImpl = fetchReturning(200, { private: false, visibility: 'public' });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
    expect(stdout).not.toHaveBeenCalled();
  });

  it('returns a `private` finding when the GitHub API reports the repo as private', async () => {
    const fetchImpl = fetchReturning(200, { private: true, visibility: 'private' });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', githubToken: 't', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ githubRepository: 'acme/widget', reason: 'private' });
  });

  it('treats a 200 with non-public visibility as private', async () => {
    const fetchImpl = fetchReturning(200, { private: false, visibility: 'internal' });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ githubRepository: 'acme/widget', reason: 'private' });
  });

  it('treats a 200 with no visibility field and private: false as public', async () => {
    const fetchImpl = fetchReturning(200, { private: false });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
  });

  it('treats a non-string visibility as unknown, not private', async () => {
    const fetchImpl = fetchReturning(200, { private: false, visibility: 1 });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
  });

  it('returns a `not-found-or-private` finding on a 404', async () => {
    const fetchImpl = fetchReturning(404, { message: 'Not Found' });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ githubRepository: 'acme/widget', reason: 'not-found-or-private' });
    expect(stdout).not.toHaveBeenCalled();
  });

  it('skips without a request when githubRepository is undefined, empty, or blank', async () => {
    const fetchImpl = vi.fn();
    for (const githubRepository of [undefined, '', '   ']) {
      await expect(
        checkRepoPublic({ githubRepository, fetchImpl: fetchImpl as unknown as typeof fetch }),
      ).resolves.toBeNull();
    }
    await expect(checkRepoPublic()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends a GET to the repos endpoint with GitHub JSON accept and a user-agent, and no auth without a token', async () => {
    const fetchImpl = fetchReturning(200, { private: false });
    await checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.github.com/repos/acme/widget');
    expect(requestInit(fetchImpl)).toEqual({
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'putitoutthere',
      },
    });
  });

  it('sends Authorization: Bearer <token> when githubToken is supplied', async () => {
    const fetchImpl = fetchReturning(200, { private: false });
    await checkRepoPublic({ githubRepository: 'acme/widget', githubToken: 'ghs_abc123', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((requestInit(fetchImpl).headers as Record<string, string>).authorization).toBe('Bearer ghs_abc123');
  });

  it('sends no Authorization header for an empty token', async () => {
    const fetchImpl = fetchReturning(200, { private: false });
    await checkRepoPublic({ githubRepository: 'acme/widget', githubToken: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(requestInit(fetchImpl).headers).not.toHaveProperty('authorization');
  });

  it('queries the slug normalized from the trimmed input', async () => {
    const fetchImpl = fetchReturning(404, {});
    await expect(
      checkRepoPublic({ githubRepository: '  https://github.com/acme/widget.git  ', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ githubRepository: 'acme/widget', reason: 'not-found-or-private' });
    expect(normalizeMock).toHaveBeenCalledWith('https://github.com/acme/widget.git');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.github.com/repos/acme/widget');
  });

  it('falls back to the raw input when it does not normalize to owner/repo', async () => {
    normalizeMock.mockReturnValue(null);
    const fetchImpl = fetchReturning(404, { message: 'Not Found' });
    await expect(
      checkRepoPublic({ githubRepository: 'garbage-not-a-slug', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toEqual({ githubRepository: 'garbage-not-a-slug', reason: 'not-found-or-private' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.github.com/repos/garbage-not-a-slug');
  });

  it.each([403, 429, 500])('returns null and warns on an indeterminate %i', async (status) => {
    const fetchImpl = fetchReturning(status, { message: 'nope' });
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
    expect(stdout).toHaveBeenCalledWith(
      `::warning::repository visibility check skipped for acme/widget: GitHub API returned ${status}\n`,
    );
  });

  it('returns null and warns when the request itself rejects', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNRESET')));
    await expect(
      checkRepoPublic({ githubRepository: 'acme/widget', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
    expect(stdout).toHaveBeenCalledWith(
      '::warning::repository visibility check skipped for acme/widget: request failed (ECONNRESET)\n',
    );
  });

  it('falls back to the global fetch when no fetchImpl is injected', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { private: false }));
    try {
      await expect(checkRepoPublic({ githubRepository: 'acme/widget' })).resolves.toBeNull();
      expect(spy).toHaveBeenCalledWith(
        'https://api.github.com/repos/acme/widget',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
