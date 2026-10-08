import { normalizeOwnerRepo } from './normalize-owner-repo.js';

export interface RepoVisibilityOptions {
  /** `owner/repo` from `GITHUB_REPOSITORY`. When `undefined` or empty
   *  the check is a no-op. */
  githubRepository?: string | undefined;
  /** Token used to authenticate the GitHub API call. Optional — the
   *  visibility endpoint is reachable unauthenticated for public
   *  repos, and a missing token plus a 404 disambiguates to
   *  "private or non-existent" which the check reports either way. */
  githubToken?: string | undefined;
  /** Injection seam for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface RepoVisibilityFinding {
  /** The `owner/repo` whose visibility check failed. */
  githubRepository: string;
  /** Either the API said `private: true`, or the API replied with a
   *  404 (which for our purposes is indistinguishable from private —
   *  in both cases consumers cannot dereference a provenance source
   *  pointer to inspect it). */
  reason: 'private' | 'not-found-or-private';
}

export async function checkRepoPublic(
  options: RepoVisibilityOptions = {},
): Promise<RepoVisibilityFinding | null> {
  const githubRepository = options.githubRepository?.trim();
  if (githubRepository === undefined || githubRepository.length === 0) {
    return null;
  }
  // Fall back to the raw value if normalization fails; the API call
  // will 404 and the check will report `not-found-or-private`, which
  // is the right diagnosis for a malformed slug we can't disambiguate.
  const apiSlug = normalizeOwnerRepo(githubRepository) ?? githubRepository;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'putitoutthere',
  };
  if (options.githubToken !== undefined && options.githubToken.length > 0) {
    headers.authorization = `Bearer ${options.githubToken}`;
  }
  const url = `https://api.github.com/repos/${apiSlug}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers });
  } catch (err) {
    // A network failure says nothing about repository visibility.
    // Treat it as indeterminate rather than blocking the release.
    warnIndeterminate(apiSlug, `request failed (${(err as Error).message})`);
    return null;
  }
  if (res.status === 404) {
    return { githubRepository: apiSlug, reason: 'not-found-or-private' };
  }
  if (res.status === 200) {
    const body = (await res.json()) as { private?: unknown; visibility?: unknown };
    const isPrivate =
      body.private === true ||
      (typeof body.visibility === 'string' && body.visibility !== 'public');
    if (isPrivate) {
      return { githubRepository: apiSlug, reason: 'private' };
    }
    return null;
  }
  // Any other status (most commonly a 403 from an unauthenticated
  // rate-limited call, or a transient 5xx) tells us nothing about
  // visibility. Blocking the publish on "we couldn't reach the API"
  // is the kind of release surprise this engine exists to prevent —
  // treat it as indeterminate and non-fatal, with a visible warning.
  warnIndeterminate(apiSlug, `GitHub API returned ${res.status}`);
  return null;
}

function warnIndeterminate(apiSlug: string, detail: string): void {
  process.stdout.write(
    `::warning::repository visibility check skipped for ${apiSlug}: ${detail}\n`,
  );
}
