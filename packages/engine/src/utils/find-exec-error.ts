import { ExecError } from './exec-error.js';

/**
 * The `ExecError` a thrown error was built from, or null when none is in its
 * cause chain. Handlers rethrow a rendered message with the original as
 * `cause`, which left the failure dump reporting an empty command, empty stdout
 * and exit -1 (#617). Depth is bounded: `cause` is caller-supplied and cyclic.
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
