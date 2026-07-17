/**
 * Match cargo's stderr shape when crates.io rejects the TP exchange because
 * the crate has never been published, and return the evidence. The fixture at
 * `tests/integration/fixtures/registry-responses/crates-io/publish-first-publish-tp-rejected.txt`
 * captures the canonical shape; the catalog at `notes/upstream-behaviors.md`
 * is the source of truth for the contract.
 *
 * Two anchors keep false positives out: a 404-status line and either the
 * registry's "crate `<name>` does not exist" prose or the "trusted publish"
 * mention. An unrelated 404 in some other cargo subcommand (e.g. a missing
 * index file) won't carry the prose; an unrelated `does not exist` (e.g. a
 * missing dependency) won't carry the 404 status.
 *
 * Returns the matched `stderr` verbatim (always non-empty, since the pattern
 * cannot match an empty string) so callers can hoist it into the surfaced
 * error without a dead empty-string fallback; returns `null` when the shape
 * does not match or `stderr` is absent.
 */
export function matchFirstPublishTpRejection(stderr: string | undefined): string | null {
  if (!stderr) {return null;}
  if (!/status\s+404\b/i.test(stderr)) {return null;}
  return /crate\s+`[^`]+`\s+does\s+not\s+exist/i.test(stderr) ||
    /trusted\s+publish/i.test(stderr)
    ? stderr
    : null;
}
