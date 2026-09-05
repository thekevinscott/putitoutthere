/**
 * Narrow one entry of TestPyPI's release `urls` array to the two fields this
 * gate reads — the filename it writes to disk and the immutable
 * `test-files.pythonhosted.org` URL it fetches. `null` for anything that does
 * not carry both as strings. Pure.
 */

import type { ReleaseFile } from './release-file-types.js';

export function asReleaseFile(entry: unknown): ReleaseFile | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { filename, url } = entry as { filename?: unknown; url?: unknown };
  if (typeof filename !== 'string' || typeof url !== 'string') {
    return null;
  }
  return { filename, url };
}
