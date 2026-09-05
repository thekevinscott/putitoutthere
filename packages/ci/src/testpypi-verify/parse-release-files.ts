/**
 * Decision core for TestPyPI's release-metadata document: split its `urls`
 * array into the wheels and sdists the release publishes. `null` when the body
 * is not JSON, or carries no `urls` array — a shape this gate cannot act on.
 * Pure.
 *
 * Files are classified by filename suffix rather than by the `packagetype`
 * field, so this agrees by construction with the downstream selectors
 * (`selectDownloadedWheel` / `selectDownloadedSdist`), which match on the same
 * suffixes.
 */

import { asReleaseFile } from './as-release-file.js';
import type { ReleaseFile, ReleaseFiles } from './release-file-types.js';

export function parseReleaseFiles(body: string): ReleaseFiles | null {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return null;
  }
  // Only `null` needs rejecting before the read: every other JSON scalar
  // answers `.urls` with undefined, which the array check below catches.
  if (document === null) {
    return null;
  }
  const { urls } = document as { urls?: unknown };
  if (!Array.isArray(urls)) {
    return null;
  }
  const wheels: ReleaseFile[] = [];
  const sdists: ReleaseFile[] = [];
  for (const entry of urls) {
    const file = asReleaseFile(entry);
    if (file === null) {
      continue;
    }
    if (file.filename.endsWith('.whl')) {
      wheels.push(file);
    } else if (file.filename.endsWith('.tar.gz')) {
      sdists.push(file);
    }
  }
  return { wheels, sdists };
}
