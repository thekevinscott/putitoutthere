/**
 * Derive the filename an anchor href points at, reproducing the bash's
 * `unquote(urlparse(href).path.rsplit("/", 1)[-1])`: strip the URL fragment
 * and query, take the last path segment, then percent-decode it. Works for
 * both absolute and relative hrefs (the last segment is the filename either
 * way). Pure.
 */

import { unquote } from './unquote.js';

export function sdistFilenameFromHref(href: string): string {
  const hash = href.indexOf('#');
  const withoutFragment = hash === -1 ? href : href.slice(0, hash);
  const query = withoutFragment.indexOf('?');
  const withoutQuery = query === -1 ? withoutFragment : withoutFragment.slice(0, query);
  const lastSegment = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  return unquote(lastSegment);
}
