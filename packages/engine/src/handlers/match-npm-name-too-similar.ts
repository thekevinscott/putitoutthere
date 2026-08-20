/**
 * Match npm's stderr shape when the registry refuses to *create* a package
 * name under its moniker rule, and return the evidence. The fixture at
 * `tests/integration/fixtures/registry-responses/npm/publish-e403-name-too-similar.txt`
 * captures the canonical shape; the catalog at `notes/upstream-behaviors.md`
 * is the source of truth for the contract.
 *
 * One anchor, not two. The crates-side `matchFirstPublishTpRejection` needs a
 * pair because each of its anchors ("status 404", "does not exist") is generic
 * enough to appear in unrelated cargo output; npm's "Package name too similar
 * to existing package…" prose is already unique to this refusal, and pairing
 * it with the `E403` code would only make the matcher miss the day npm
 * renumbers the response. Both known wordings — the one that names the
 * blocking package and the plural "existing packages" variant — differ only
 * after this prefix.
 *
 * Matching on the prose is the whole point: the refusal arrives auth-shaped
 * (E403 / "Forbidden"), so status-code matching cannot tell it apart from an
 * ordinary permission failure. That confusion is #617 — the engine read one
 * as the other and told an operator to bootstrap with a token, for a name no
 * token can create.
 *
 * Returns the matched `stderr` verbatim (always non-empty, since the pattern
 * cannot match an empty string) so callers can hoist it into the surfaced
 * error without a dead empty-string fallback; returns `null` when the shape
 * does not match or `stderr` is absent.
 */
export function matchNpmNameTooSimilar(stderr: string | undefined): string | null {
  return stderr?.match(/package\s+name\s+too\s+similar\s+to\s+existing\s+packages?/i)
    ? stderr
    : null;
}
