import { ExecError } from './exec-error.js';

/**
 * Whether a failed `gh` invocation is a transient GitHub-side error worth
 * retrying (#613): the subprocess failed with a 5xx on its stderr (e.g.
 * `gh: Server Error (HTTP 502)`). Anything else — 4xx, spawn failures,
 * non-ExecError values — is treated as permanent.
 */
export function isTransientGhError(err: unknown): boolean {
  return err instanceof ExecError && /\(HTTP 5\d\d\)/.test(err.stderr);
}
