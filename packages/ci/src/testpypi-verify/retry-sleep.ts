/**
 * The retry budget shared by the release-metadata poll and the artifact
 * downloads.
 *
 * `retrySleepSeconds` is the back-off, in seconds, before retry `attempt`,
 * reproducing the bash's `sleep_for=$((attempt * 10))`. Pure.
 *
 * `MAX_ATTEMPTS` bounds every loop that uses it. It lives here, next to the
 * back-off it multiplies, because the two only mean anything together: what
 * the gate actually needs is a *duration*, and neither number states one alone
 * (`retryBudgetSeconds` turns the pair into one). They were previously
 * declared once per download module, which is how they drift.
 *
 * Ten attempts spend 10+20+…+90 = 450s. That number was chosen in #642/#643 to
 * outlast TestPyPI's `/simple/` index propagation lag, and it did not — the
 * budget was exhausted on #645 and #663 with the publish already successful,
 * because `/simple/{project}/` is an edge-cached page whose staleness no
 * amount of polling shortens. #668 moved discovery to the version-pinned
 * release-metadata URL, which cannot be served stale, so this budget no longer
 * guards a CDN TTL; it now only absorbs a read replica trailing an accepted
 * upload by seconds, and a transport fault on an artifact fetch. It is kept at
 * 450s so the pathological case is no slower than before.
 *
 * It stays bounded on purpose: a version that never appears must still fail
 * the gate rather than hang the job.
 */

export const MAX_ATTEMPTS = 10;

export function retrySleepSeconds(attempt: number): number {
  return attempt * 10;
}
