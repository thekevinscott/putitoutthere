/**
 * The URL of TestPyPI's version-pinned release-metadata document,
 * `<origin>/pypi/{package}/{version}/json`, derived from the configured simple
 * index URL so both point at the same instance. Version-pinned is load-bearing
 * (#668): versions are timestamps, so it can never be served stale. Pure.
 */

export function releaseJsonUrl(indexUrl: string, pkg: string, version: string): string | null {
  const parsed = URL.parse(indexUrl);
  return parsed === null ? null : `${parsed.origin}/pypi/${pkg}/${version}/json`;
}
