/**
 * Stable error-code vocabulary.
 *
 * User-facing errors and GitHub Actions `::error::` annotations carry
 * one of these codes so external observers — humans grepping the run
 * log, foreign LLM agents debugging a failed publish, the docs site
 * deep-linking from a code to a recipe — can fingerprint the failure
 * mode without parsing free-form prose.
 *
 * Codes are deliberately verbose. The string is the diagnostic; brevity
 * here just creates ambiguity at a distance.
 *
 * Adding a new code: add it to BOTH `ErrorCodes` and `ALL_ERROR_CODES`;
 * the test in `error-codes.test.ts` enforces parity. Once a code ships
 * in a public-surfaced error message it becomes a stable identifier —
 * rename only with a migration entry.
 */

export const ErrorCodes = {
  /** Generic auth failure when no registry token resolved. Used by
   *  npm/crates handlers; PyPI no longer surfaces this code (the
   *  upload moved to a caller-side job per the reusable-workflow
   *  TP constraint — see notes/audits/). */
  AUTH_NO_TOKEN: 'PIOT_AUTH_NO_TOKEN',
  /** `publish` was invoked but `plan` returned zero rows for a reason
   *  other than `release: skip`. Almost always indicates the cascade
   *  did not trigger (no committed file matched any package's globs
   *  since its last tag) or that the plan and publish jobs disagreed
   *  on what HEAD looked like. The reusable workflow's gate should
   *  prevent this from being reached; if it fires, the gate was
   *  bypassed or the engine is inconsistent. */
  PUBLISH_EMPTY_PLAN: 'PIOT_PUBLISH_EMPTY_PLAN',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Iterable form of the codes. Walked by tests for uniqueness/format
 * checks and by future tooling that renders a code reference table.
 */
export const ALL_ERROR_CODES: readonly ErrorCode[] = [
  ErrorCodes.AUTH_NO_TOKEN,
  ErrorCodes.PUBLISH_EMPTY_PLAN,
];
