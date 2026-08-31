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

/**
 * npm's machine-readable failure code line, in either prefix spelling:
 * `npm error code ENOTFOUND` / `npm ERR! code ENOTFOUND`.
 */
const CODE_LINE = /^npm (?:error|ERR!) code (\S+)$/m;

/** DNS resolution failed — there is no registry to talk to. */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set(['ENOTFOUND', 'EAI_AGAIN']);

/** The registry was reached and the request faltered. */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ERR_SOCKET_TIMEOUT',
  'E429',
]);

/** npm renders an HTTP status as `E<status>`; 5xx is the registry's fault. */
const SERVER_ERROR_CODE = /^E5[0-9][0-9]$/;

export function classifyNpmViewFailure(stderr: string | undefined): NpmViewFailure {
  const code = CODE_LINE.exec(stderr ?? '')?.[1];
  if (code === undefined) {return 'absent';}
  if (UNREACHABLE_CODES.has(code)) {return 'unreachable';}
  if (TRANSIENT_CODES.has(code)) {return 'transient';}
  if (SERVER_ERROR_CODE.test(code)) {return 'transient';}
  return 'absent';
}
