/**
 * Composition root for the resolve phase of `testpypi-verify metadata`: turn
 * every pinned requirement into the artifact URLs TestPyPI published for it,
 * stopping at the first that cannot be resolved or whose file list is missing
 * an artifact. Runs before any download, so a release that is absent or the
 * wrong shape is reported as such rather than as a failed fetch.
 */

import type { ReleaseFiles } from './release-file-types.js';
import { releaseShapeError } from './release-shape-error.js';
import { resolveRelease } from './resolve-release.js';

export type ResolveReleasesResult = { releases: Map<string, ReleaseFiles> } | { errorLine: string };

export async function resolveReleases(
  requirements: readonly string[],
  indexUrl: string,
): Promise<ResolveReleasesResult> {
  const releases = new Map<string, ReleaseFiles>();
  for (const requirement of requirements) {
    const resolved = await resolveRelease(requirement, indexUrl);
    if ('errorLine' in resolved) {
      return { errorLine: resolved.errorLine };
    }
    const shapeError = releaseShapeError(requirement, resolved.files);
    if (shapeError !== null) {
      return { errorLine: shapeError };
    }
    releases.set(requirement, resolved.files);
  }
  return { releases };
}
