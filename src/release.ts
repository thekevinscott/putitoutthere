/**
 * GitHub Release creation.
 *
 * After a successful tag push (§13.6), create a Release on GitHub so
 * the new version shows up in the repo's Releases UI with body notes
 * generated from the commit history since the previous tag.
 *
 * No external action dependency -- uses the GitHub REST API via
 * fetch with the caller-supplied GITHUB_TOKEN (or the default
 * GITHUB_TOKEN available to every Actions run).
 *
 * Issue #26. Plan: §15.
 */

import { execFileSync } from 'node:child_process';

export interface CreateReleaseOptions {
  tag: string;
  title: string;
  body: string;
  /** Override for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface ReleaseResult {
  url: string;
}

/**
 * Generate release notes from `git log <prev_tag>..<this_tag>` subject
 * lines. If no prior tag exists for this package, falls back to the
 * full history (first release).
 *
 * The filter is subject-only -- commit bodies add noise and are
 * already available on the tag itself.
 */
export function generateReleaseNotes(
  packageName: string,
  tagName: string,
  opts: { cwd: string },
): string {
  const prev = findPreviousTag(packageName, tagName, opts.cwd);
  const range = prev ? `${prev}..${tagName}` : tagName;
  const out = runGit(['log', range, '--format=- %s', '--no-merges'], opts.cwd);
  return out.trim();
}

export async function createGitHubRelease(
  opts: CreateReleaseOptions,
): Promise<ReleaseResult | null> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    // Local runs (putitoutthere doctor, operator on laptop) don't have
    // these. Silent-skip so we don't confuse operators with a failure
    // that doesn't matter outside Actions.
    return null;
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `https://api.github.com/repos/${repository}/releases`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      'user-agent': 'putitoutthere',
    },
    body: JSON.stringify({
      tag_name: opts.tag,
      name: opts.title,
      body: opts.body,
      draft: false,
      prerelease: isPrerelease(opts.tag),
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`GitHub release API ${res.status}: ${msg}`);
  }
  const data = (await res.json()) as { html_url?: string };
  return { url: data.html_url ?? '' };
}

/* ------------------------------ internals ------------------------------ */

function isPrerelease(tag: string): boolean {
  return /-(rc|beta|alpha)(\.|$)/.test(tag);
}

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
    /* v8 ignore start -- defensive wrap */
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
  /* v8 ignore stop */
}

function findPreviousTag(
  packageName: string,
  currentTag: string,
  cwd: string,
): string | null {
  const prefix = `${packageName}-v`;
  const tags = runGit(['tag', '-l', `${prefix}*.*.*`], cwd)
    .split('\n')
    .filter((t) => t && t !== currentTag)
    .sort(compareSemverTags(prefix));
  return tags.length > 0 ? tags[tags.length - 1]! : null;
}

function compareSemverTags(prefix: string): (a: string, b: string) => number {
  return (a, b) => {
    const [am, an, ap] = parseVer(a.slice(prefix.length));
    const [bm, bn, bp] = parseVer(b.slice(prefix.length));
    if (am !== bm) return am - bm;
    if (an !== bn) return an - bn;
    return ap - bp;
  };
}

function parseVer(v: string): [number, number, number] {
  const parts = v.split('.').map((n) => parseInt(n, 10));
  /* v8 ignore next -- tag-glob filter already enforces x.y.z shape */
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
