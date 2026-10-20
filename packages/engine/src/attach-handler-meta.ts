import { HANDLER_META_KEY } from './handler-meta-key.js';
import type { HandlerErrorMeta } from './types.js';

/** Attach handler-failure metadata to an Error and return the same
 *  Error (so callers can `throw attachHandlerMeta(new Error(...), {...})`). */
export function attachHandlerMeta<E extends Error>(err: E, meta: HandlerErrorMeta): E {
  (err as E & { [HANDLER_META_KEY]?: HandlerErrorMeta })[HANDLER_META_KEY] = meta;
  return err;
}
