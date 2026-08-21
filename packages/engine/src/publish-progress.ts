/**
 * Carry a failed publish run's partial progress out through the thrown
 * error (#623).
 *
 * `publish()` walks packages in dependency order and throws on the first
 * handler failure, which loses what the packages before it did. That
 * matters for one caller-visible fact: a PyPI package whose upload was
 * `delegated` to a caller-side job needs to be announced on
 * `$GITHUB_OUTPUT` even when a *later*, unrelated package fails — that
 * announcement is what lets the caller's upload job gate on "PyPI's own
 * path succeeded" rather than on whole-job success. Without it, a missing
 * npm scope silently skips the PyPI upload.
 *
 * Attached at the publish boundary and read by the CLI, mirroring the
 * `attachHandlerMeta` / `readHandlerMeta` pair in `types.ts` — an own
 * property on the Error rather than a wrapper, so the handler's own error
 * (its message, its `cause` chain, its attached metadata) reaches the CLI
 * unchanged.
 */

import type { PublishOutput } from './publish.js';

const PROGRESS_KEY = '__piotPublishProgress';

type Carrier = Error & { [PROGRESS_KEY]?: PublishOutput['published'] };

/** Attach the packages processed so far and return the same Error. */
export function attachPublishProgress<E extends Error>(
  err: E,
  published: PublishOutput['published'],
): E {
  (err as E & Carrier)[PROGRESS_KEY] = published;
  return err;
}

/** Read attached progress; `[]` for non-Errors and unannotated Errors. */
export function readPublishProgress(value: unknown): PublishOutput['published'] {
  if (!(value instanceof Error)) {return [];}
  return (value as Carrier)[PROGRESS_KEY] ?? [];
}
