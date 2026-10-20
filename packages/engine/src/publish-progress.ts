/**
 * Carry a failed publish run's partial progress out through the thrown error
 * (#623). `publish()` throws on the first handler failure, which would lose
 * that an earlier PyPI package was `delegated` — the caller's upload job gates
 * on that, so without it a missing npm scope silently skips the PyPI upload.
 */

import type { PublishOutput } from './publish.js';

export type Carrier = Error & { __piotPublishProgress?: PublishOutput['published'] };

/** Attach the packages processed so far and return the same Error. */
export function attachPublishProgress<E extends Error>(
  err: E,
  published: PublishOutput['published'],
): E {
  (err as E & Carrier).__piotPublishProgress = published;
  return err;
}
