/**
 * Match npm's stderr when the registry refuses to *create* a name under its
 * moniker rule ("Package name too similar to existing package…"), returning
 * the matched `stderr` verbatim, else `null`. Prose, not status code: the
 * refusal arrives auth-shaped (E403 / "Forbidden"), so #617 misread it.
 */
export function matchNpmNameTooSimilar(stderr: string | undefined): string | null {
  return stderr?.match(/package\s+name\s+too\s+similar\s+to\s+existing\s+packages?/i)
    ? stderr
    : null;
}
