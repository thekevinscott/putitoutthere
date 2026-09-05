/**
 * Decision core for "the release exists, but is it the release we published?"
 * Returns the `::error::` line for a release whose file list is missing a
 * wheel or an sdist, or `null` when both are present. Pure.
 *
 * This is deliberately terminal rather than retried (#668): a release the
 * registry has already committed will not grow a missing artifact later, so
 * spending the propagation budget on it only delays an answer already known.
 */

import type { ReleaseFiles } from './release-file-types.js';

export function releaseShapeError(requirement: string, files: ReleaseFiles): string | null {
  if (files.wheels.length === 0) {
    return `::error::${requirement} is published to TestPyPI but its release lists no wheel`;
  }
  if (files.sdists.length === 0) {
    return `::error::${requirement} is published to TestPyPI but its release lists no sdist`;
  }
  return null;
}
