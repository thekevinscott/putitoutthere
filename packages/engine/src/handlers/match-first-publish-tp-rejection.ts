/**
 * Match cargo's stderr when crates.io rejects the TP exchange because the crate
 * has never been published; returns the matched `stderr` verbatim, else `null`.
 * Two anchors keep false positives out: a 404-status line *plus* either
 * "crate `<name>` does not exist" or "trusted publish" (notes/upstream-behaviors.md).
 */
export function matchFirstPublishTpRejection(stderr: string | undefined): string | null {
  return stderr?.match(/status\s+404\b/i) &&
    (stderr.match(/crate\s+`[^`]+`\s+does\s+not\s+exist/i) ||
      stderr.match(/trusted\s+publish/i))
    ? stderr
    : null;
}
