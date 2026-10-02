/**
 * Carry a failed publish run's partial progress out through the thrown error
 * (#623). `publish()` throws on the first handler failure, which would lose
 * that an earlier PyPI package was `delegated` — the caller's upload job gates
 * on that, so without it a missing npm scope silently skips the PyPI upload.
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
