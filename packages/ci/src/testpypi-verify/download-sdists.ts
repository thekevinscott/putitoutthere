/**
 * Composition root for the sdist-download phase of `testpypi-verify metadata`.
 * Reproduces the bash heredoc that, per requirement, fetched the project's
 * simple-index page, found the anchor whose filename ends with
 * `-{version}.tar.gz`, and downloaded it — retrying up to six times, sleeping
 * `attempt*10`s, and failing on the sixth with `failed to download sdist for
 * {req}: {exc}`. The HTTP GETs run through `curl` (the same subprocess
 * boundary the sibling harness gates use) so the network is mockable; the
 * href parsing / filename / match decisions are the pure cores'. Returns the
 * exit code (0 = all sdists downloaded).
 */

import { execCapture } from '../utils/exec-capture.js';
import { sleep } from '../utils/sleep.js';
import { errorMessage } from './error-message.js';
import { findSdistHref } from './find-sdist-href.js';
import { normalizeIndexUrl } from './normalize-index-url.js';
import { parseRequirement } from './parse-requirement.js';
import { parseSimpleIndexHrefs } from './parse-simple-index.js';
import { retrySleepSeconds } from './retry-sleep.js';
import { sdistFilenameFromHref } from './sdist-filename.js';

const SDISTS_DIR = 'downloaded-sdists';
const MAX_ATTEMPTS = 6;
// A PEP 503 simple-index page lists every file ever published for the
// project, so it grows without bound as fixtures accumulate versions (the
// maturin fixture's page is already ~1.1 MiB). `execFileSync` captures the
// curl stdout into a fixed buffer whose default is 1 MiB and throws
// `ENOBUFS` when the page exceeds it — a limit the original bash never had
// (it piped curl into a streaming HTML parser). Give the capture ample room.
const SIMPLE_INDEX_MAX_BUFFER = 64 * 1024 * 1024;

export async function downloadSdists(requirements: readonly string[], indexUrl: string): Promise<number> {
  const indexNorm = normalizeIndexUrl(indexUrl);
  for (const requirement of requirements) {
    const { package: pkg, version } = parseRequirement(requirement);
    const projectUrl = `${indexNorm}${pkg}/`;
    const expectedSuffix = `-${version}.tar.gz`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const { stdout: html } = await execCapture('curl', ['-fsS', projectUrl], {
          maxBuffer: SIMPLE_INDEX_MAX_BUFFER,
        });
        const href = findSdistHref(parseSimpleIndexHrefs(html), expectedSuffix);
        if (href === null) {
          throw new Error(`no sdist ending ${expectedSuffix} on ${projectUrl}`);
        }
        const artifactUrl = new URL(href, projectUrl).toString();
        process.stdout.write(`Downloading sdist for ${requirement} from ${artifactUrl}\n`);
        await execCapture('curl', ['-fsS', '-o', `${SDISTS_DIR}/${sdistFilenameFromHref(href)}`, artifactUrl]);
        break;
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          process.stderr.write(`failed to download sdist for ${requirement}: ${errorMessage(error)}\n`);
          return 1;
        }
        const sleepFor = retrySleepSeconds(attempt);
        process.stdout.write(`TestPyPI sdist index lag for ${requirement}; retrying in ${sleepFor}s\n`);
        await sleep(sleepFor * 1000);
      }
    }
  }
  return 0;
}
