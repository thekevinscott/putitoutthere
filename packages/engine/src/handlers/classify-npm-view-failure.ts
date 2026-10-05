/**
 * What a failed `npm view` probe actually means (#650). Keyed off npm's own
 * machine-readable `code` line rather than its prose: `absent` for `E404` plus
 * anything unrecognised (the conservative default), `unreachable` for
 * `ENOTFOUND` / `EAI_AGAIN`, `transient` for timeouts / resets / 429 / 5xx.
 */

export type NpmViewFailure = 'absent' | 'unreachable' | 'transient';

export function classifyNpmViewFailure(stderr: string): NpmViewFailure {
  // Function-scoped, not module-scoped: mutants in module-level initializers
  // run once at import, out of reach of the gate's per-test switching.
  /**
   * npm's machine-readable failure code, in either prefix spelling:
   * `npm error code ENOTFOUND` (npm 11) / `npm ERR! code ENOTFOUND` (npm <= 10).
   * The prefix sits in a lookbehind, not a capture group, so the match *is* the
   * code — a group would be `string | undefined` under `noUncheckedIndexedAccess`.
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
