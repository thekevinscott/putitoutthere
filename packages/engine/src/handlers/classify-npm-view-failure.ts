/**
 * What a failed `npm view` probe actually means (#650).
 *
 * `isPublished` asks npm whether a version exists by shelling out to
 * `npm view <name>@<version> version` and reading the exit status. Every
 * non-zero exit used to mean the same thing — "not published" — which is
 * true for the answer the probe was written for (`E404`) and false for
 * every way the question can fail to be asked at all. A hermetic
 * (`--network none`) `plan` run reported `verdict: publish` for packages it
 * had never reached the registry to ask about.
 *
 * Three outcomes, keyed off npm's own machine-readable `npm error code`
 * line:
 *
 *  - `absent` — the registry answered and the version is not there
 *    (`E404`), plus anything unrecognised. The historical behaviour, and
 *    the conservative default: an unfamiliar code keeps the pre-#650
 *    reading rather than inventing a new failure mode for it.
 *  - `unreachable` — the registry hostname does not resolve
 *    (`ENOTFOUND` / `EAI_AGAIN`). Deterministic within a run: no retry can
 *    turn a name that does not resolve into one that does, and no answer
 *    is coming, so the caller reports "unknown", not "not published".
 *  - `transient` — the registry was reached and faltered (timeouts, reset
 *    connections, 429, 5xx). These are the cases the retry policy was
 *    written for, so the caller raises a `TransientError` and lets
 *    `withRetry` do its job.
 *
 * Matching npm's `code` line rather than its prose keeps this stable
 * across npm's message rewrites; both the modern `npm error` prefix (npm
 * 11) and the legacy `npm ERR!` one (npm ≤ 10, still on plenty of
 * consumer runners) are accepted.
 */

export type NpmViewFailure = 'absent' | 'unreachable' | 'transient';

export function classifyNpmViewFailure(stderr: string): NpmViewFailure {
  // Function-scoped, not module-scoped: mutants in module-level initializers
  // run once at import, where the mutation gate's per-test switching cannot
  // reach them, so they were reported surviving despite the colocated tests
  // killing every one when applied by hand.
  /**
   * npm's machine-readable failure code, in either prefix spelling:
   * `npm error code ENOTFOUND` (npm 11) / `npm ERR! code ENOTFOUND` (npm <= 10).
   *
   * The prefix sits in a lookbehind rather than a capture group so the match
   * *is* the code. A capture group would be typed `string | undefined` under
   * `noUncheckedIndexedAccess`, forcing a `?? ''` fallback for a group that
   * cannot fail to participate — an unreachable default no test can pin.
   */
  const codeLine = /(?<=^npm (?:error|ERR!) code )\S+$/m;
  /** DNS resolution failed — there is no registry to talk to. */
  const unreachableCodes: ReadonlySet<string> = new Set(['ENOTFOUND', 'EAI_AGAIN']);
  /** The registry was reached and the request faltered. */
  const transientCodes: ReadonlySet<string> = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'ERR_SOCKET_TIMEOUT',
    'E429',
  ]);
  /** npm renders an HTTP status as `E<status>`; 5xx is the registry's fault. */
  const serverErrorCode = /^E5[0-9][0-9]$/;

  const match = codeLine.exec(stderr);
  if (match === null) {
    // npm said nothing we can read a code out of. Unrecognised shapes keep
    // the pre-#650 reading rather than inventing a failure mode for them.
    return 'absent';
  }
  const code = match[0];
  if (unreachableCodes.has(code)) {return 'unreachable';}
  if (transientCodes.has(code)) {return 'transient';}
  if (serverErrorCode.test(code)) {return 'transient';}
  return 'absent';
}
