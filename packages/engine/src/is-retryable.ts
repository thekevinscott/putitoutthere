import { extractProp } from './extract-prop.js';
import { AuthError, TransientError } from './types.js';

export function isRetryable(err: unknown): boolean {
  if (err instanceof AuthError) {return false;}
  if (err instanceof TransientError) {return true;}
  // Network-ish error codes used by Node's net/http stack.
  const code = extractProp(err, 'code');
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT') {return true;}
  // HTTP-status-tagged errors: retry 5xx and 429.
  const status = extractProp(err, 'status');
  if (typeof status === 'number') {
    if (status === 429) {return true;}
    if (status >= 500 && status < 600) {return true;}
  }
  return false;
}
