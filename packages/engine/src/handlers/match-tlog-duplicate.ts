/**
 * Match npm's Sigstore/Rekor dedupe error (`TLOG_CREATE_ENTRY_ERROR` / "an
 * equivalent entry already exists in the transparency log"); returns the
 * matched `stderr`, else `null`. Does NOT prove the package landed — a Rekor
 * entry can outlive a failed registry PUT — so callers must re-probe `npm view`.
 */
export function matchTlogDuplicate(stderr: string | undefined): string | null {
  return stderr?.match(
    /TLOG_CREATE_ENTRY_ERROR|equivalent entry already exists in the transparency log/i,
  )
    ? stderr
    : null;
}
