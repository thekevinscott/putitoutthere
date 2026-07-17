/**
 * Match npm's Sigstore/Rekor transparency-log dedupe error and return the
 * evidence. The retry-on-transient-network-error that produces the
 * publish-over race also re-submits an identical `--provenance` attestation;
 * Rekor rejects the duplicate with `TLOG_CREATE_ENTRY_ERROR` / "an
 * equivalent entry already exists in the transparency log". Unlike the
 * publish-over race, a 409 here does NOT by itself prove the package landed
 * (the first submit may have written the Rekor entry but failed the registry
 * PUT), so callers must re-probe `npm view` to disambiguate.
 *
 * Returns the matched `stderr` verbatim (always non-empty, since the pattern
 * cannot match an empty string) so callers can hoist it into the surfaced
 * error without a dead empty-string fallback; returns `null` when the shape
 * does not match or `stderr` is absent.
 */
export function matchTlogDuplicate(stderr: string | undefined): string | null {
  return stderr?.match(
    /TLOG_CREATE_ENTRY_ERROR|equivalent entry already exists in the transparency log/i,
  )
    ? stderr
    : null;
}
