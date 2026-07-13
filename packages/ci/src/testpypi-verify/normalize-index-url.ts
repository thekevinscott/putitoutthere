/**
 * Normalise the simple-index base URL exactly like the bash's
 * `os.environ["TESTPYPI_INDEX_URL"].rstrip("/") + "/"`: strip every trailing
 * slash, then append a single one, so a project URL can be built as
 * `<normalized><package>/`. Pure.
 */

export function normalizeIndexUrl(indexUrl: string): string {
  let end = indexUrl.length;
  // `charAt(-1)` is '' (never '/'), so this also terminates at index 0.
  while (indexUrl.charAt(end - 1) === '/') {
    end -= 1;
  }
  return `${indexUrl.slice(0, end)}/`;
}
