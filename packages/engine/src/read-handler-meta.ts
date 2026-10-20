import { HANDLER_META_KEY } from './handler-meta-key.js';
import type { HandlerErrorMeta } from './types.js';

/** Read handler-failure metadata from a possibly-Error value. Returns
 *  undefined for non-Error values, plain Errors, and Errors without
 *  attached meta. */
export function readHandlerMeta(value: unknown): HandlerErrorMeta | undefined {
  if (!(value instanceof Error)) {return undefined;}
  const carrier = value as Error & { [HANDLER_META_KEY]?: HandlerErrorMeta };
  return carrier[HANDLER_META_KEY];
}
