/**
 * The retry budget shared by the release-metadata poll and the artifact
 * downloads: `attempt * 10`s of back-off, ten attempts = 450s (#642/#643).
 * Since #668 moved discovery to the version-pinned release-metadata URL it no
 * longer guards a CDN TTL, only a read replica trailing an accepted upload.
 */

export const MAX_ATTEMPTS = 10;

export function retrySleepSeconds(attempt: number): number {
  return attempt * 10;
}
