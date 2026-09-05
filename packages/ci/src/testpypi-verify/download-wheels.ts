/**
 * Composition root for the wheel-download phase of `testpypi-verify metadata`.
 * Fetches every wheel the resolved release lists, straight from its immutable
 * artifact URL, and fails with the exact `::error::failed to download wheel …`
 * line on the first that will not come down. Returns the exit code (0 = all
 * wheels downloaded).
 *
 * Replaces the `pip download --index-url …/simple/` loop this phase used to
 * run (#668): pip resolves through the simple index, so it inherited that
 * page's edge-cache staleness no matter how long the loop waited.
 */

import { downloadArtifact } from './download-artifact.js';
import type { ReleaseFiles } from './release-file-types.js';

const WHEELS_DIR = 'downloaded-wheels';

export async function downloadWheels(releases: ReadonlyMap<string, ReleaseFiles>): Promise<number> {
  for (const [requirement, files] of releases) {
    for (const wheel of files.wheels) {
      process.stdout.write(`Downloading wheel for ${requirement} from ${wheel.url}\n`);
      if (!(await downloadArtifact(wheel.url, `${WHEELS_DIR}/${wheel.filename}`))) {
        process.stdout.write(`::error::failed to download wheel for ${requirement} from TestPyPI\n`);
        return 1;
      }
    }
  }
  return 0;
}
