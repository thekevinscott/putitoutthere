import { ExecError } from './exec-error.js';

/**
 * The `ExecError` a thrown error was built from, or null when none is in
 * its cause chain.
 *
 * Handlers catch the seam's `ExecError` and rethrow a rendered message with
 * the original as `cause` — which is the right shape for a human reading one
 * line, and the wrong shape for the failure dump, which was reconstructing
 * the subprocess from that rendered sentence and so reported an empty
 * command, an empty stdout and exit code -1. Walking back to the `ExecError`
 * recovers what actually ran. #617.
 *
 * Bounded depth: `cause` is caller-supplied and can be cyclic, and no real
 * chain in this engine is more than a couple of links deep.
 */
const MAX_DEPTH = 10;

export function findExecError(err: unknown): ExecError | null {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (current instanceof ExecError) {return current;}
    if (!(current instanceof Error)) {return null;}
    current = current.cause;
  }
  return null;
}
