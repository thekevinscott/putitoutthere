/**
 * Percent-decode a URL path segment, reproducing the bash's
 * `urllib.parse.unquote`. Valid `%XX` (UTF-8) sequences decode; malformed
 * input is returned unchanged (CPython's lenient behaviour, here approximated
 * by falling back to the raw string when `decodeURIComponent` rejects it). The
 * fixture filenames carry no percent-encoding, so this is a no-op in practice,
 * but it keeps the filename extraction faithful. Pure.
 */

export function unquote(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
