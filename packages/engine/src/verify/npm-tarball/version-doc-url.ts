/**
 * URL of npm's IMMUTABLE per-version document, `GET <registry>/<name>/<version>`
 * (#716). It is written as part of the publish, so unlike the cache-fronted
 * packument it is never stale-but-present. Scoped names keep `@` literal and
 * `/` percent-encoded — the registry's path grammar, same as the handlers'
 * packument reads.
 */

export function npmVersionDocUrl(name: string, version: string, registry?: string): string {
  const base = registry ? registry.replace(/\/$/, '') : 'https://registry.npmjs.org';
  return `${base}/${encodeURIComponent(name).replaceAll('%40', '@')}/${version}`;
}
