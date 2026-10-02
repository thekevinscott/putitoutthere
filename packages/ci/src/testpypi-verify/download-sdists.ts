/**
 * Composition root for the sdist-download phase of `testpypi-verify metadata`.
 * Fetches every sdist the resolved release lists from its immutable artifact
 * URL. Replaces the simple-index scrape this phase used to run (#668): that
 * page is edge-cached, and no retry budget can outlast its staleness.
 */

import { downloadArtifact } from './download-artifact.js';
import type { ReleaseFiles } from './release-file-types.js';

const SDISTS_DIR = 'downloaded-sdists';

export async function downloadSdists(releases: ReadonlyMap<string, ReleaseFiles>): Promise<number> {
  for (const [requirement, files] of releases) {
    for (const sdist of files.sdists) {
      process.stdout.write(`Downloading sdist for ${requirement} from ${sdist.url}\n`);
      if (!(await downloadArtifact(sdist.url, `${SDISTS_DIR}/${sdist.filename}`))) {
        process.stderr.write(`failed to download sdist for ${requirement} from TestPyPI\n`);
        return 1;
      }
    }
  }
  return 0;
}
