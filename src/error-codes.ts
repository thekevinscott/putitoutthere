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
 *
 * Phase 1 / Idea 4.
 */

export const ErrorCodes = {
  /** OIDC env vars (`ACTIONS_ID_TOKEN_REQUEST_*`) absent at the moment
   *  the handler reached for them. Most often: `id-token: write` not
   *  declared on the publish job. */
  AUTH_OIDC_ENV_MISSING: 'PIOT_AUTH_OIDC_ENV_MISSING',

  /** The runner's id-token endpoint returned non-2xx. Often transient
   *  (5xx) but a 4xx points at runner-side audience or scope drift. */
  AUTH_OIDC_ID_TOKEN_HTTP: 'PIOT_AUTH_OIDC_ID_TOKEN_HTTP',

  /** The runner's id-token endpoint returned 2xx but the response body
   *  had no `value` field. Pathological; not retryable. */
  AUTH_OIDC_ID_TOKEN_EMPTY: 'PIOT_AUTH_OIDC_ID_TOKEN_EMPTY',

  /** The registry rejected the OIDC mint exchange. The body excerpt
   *  in the error detail is the diagnostic — typically a 422
   *  `invalid-publisher` with the expected `job_workflow_ref` list,
   *  signaling a Trusted Publisher registration mismatch. */
  AUTH_OIDC_MINT_REJECTED: 'PIOT_AUTH_OIDC_MINT_REJECTED',

  /** Neither OIDC nor an explicit registry token resolved. The
   *  user-facing error embeds the OIDC probe checklist alongside this
   *  code (Phase 2 / Idea 3). */
  AUTH_NO_TOKEN: 'PIOT_AUTH_NO_TOKEN',

  /** `id-token: write` is declared on the workflow but the runner did
   *  not populate `ACTIONS_ID_TOKEN_REQUEST_URL` in the action's env.
   *  Distinct from `AUTH_OIDC_ENV_MISSING`: the consumer's posture is
   *  correct, the propagation path is the bug. Phase 4 / Idea 7
   *  surfaces this in the action wrapper before the handler runs. */
  GHA_OIDC_ENV_MISSING_DESPITE_PERMISSION:
    'PIOT_GHA_OIDC_ENV_MISSING_DESPITE_PERMISSION',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Iterable form of the codes. Walked by tests for uniqueness/format
 * checks and by future tooling that renders a code reference table.
 */
export const ALL_ERROR_CODES: readonly ErrorCode[] = [
  ErrorCodes.AUTH_OIDC_ENV_MISSING,
  ErrorCodes.AUTH_OIDC_ID_TOKEN_HTTP,
  ErrorCodes.AUTH_OIDC_ID_TOKEN_EMPTY,
  ErrorCodes.AUTH_OIDC_MINT_REJECTED,
  ErrorCodes.AUTH_NO_TOKEN,
  ErrorCodes.GHA_OIDC_ENV_MISSING_DESPITE_PERMISSION,
];
