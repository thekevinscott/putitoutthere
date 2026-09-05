/**
 * The URL of TestPyPI's version-pinned release-metadata document,
 * `<origin>/pypi/{package}/{version}/json`, derived from the configured simple
 * index URL so both point at the same instance. `null` when the index URL is
 * not parseable. Pure.
 *
 * Version-pinned is the load-bearing part (#668): fixture versions are
 * timestamps, so this URL has never been requested before the publish under
 * test and cannot be served from a stale edge cache object — unlike
 * `/simple/{package}/`, which every prior run has already warmed.
 */

export function releaseJsonUrl(indexUrl: string, pkg: string, version: string): string | null {
  const parsed = URL.parse(indexUrl);
  return parsed === null ? null : `${parsed.origin}/pypi/${pkg}/${version}/json`;
}
