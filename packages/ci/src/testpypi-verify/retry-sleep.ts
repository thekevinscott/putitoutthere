/**
 * The back-off, in seconds, before retry `attempt`, reproducing the bash's
 * `sleep_for=$((attempt * 10))` / `sleep_for = attempt * 10` used by both the
 * wheel- and sdist-download retry loops. Pure.
 */

export function retrySleepSeconds(attempt: number): number {
  return attempt * 10;
}
