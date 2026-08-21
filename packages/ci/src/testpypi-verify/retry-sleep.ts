/**
 * The retry budget shared by the wheel- and sdist-download loops.
 *
 * `retrySleepSeconds` is the back-off, in seconds, before retry `attempt`,
 * reproducing the bash's `sleep_for=$((attempt * 10))` / `sleep_for =
 * attempt * 10`. Pure.
 *
 * `MAX_ATTEMPTS` bounds both loops. It lives here, next to the back-off it
 * multiplies, because the two only mean anything together: what the gate
 * actually needs is a *duration*, and neither number states one alone. They
 * were previously declared once per download module, which is how they drift.
 *
 * The duration matters because this gate's entire job is to outlast
 * TestPyPI's `/simple/` index propagation lag. `/simple/` is not backed by
 * the CDN guarantees production PyPI has, and a freshly-published version has
 * been observed taking **2m35s to 4m19s** to appear on it (#628's `E2E` run,
 * and independently #630). At six attempts the loop gave up after ~150s of
 * back-off — inside that window — so a publish that had already succeeded was
 * reported broken, and a re-run minutes later passed with no code change.
 *
 * Ten attempts spend 10+20+…+90 = 450s, which clears the slow end with
 * headroom. It stays bounded on purpose: a version that never appears must
 * still fail the gate rather than hang the job. #642.
 */

export const MAX_ATTEMPTS = 10;

export function retrySleepSeconds(attempt: number): number {
  return attempt * 10;
}
