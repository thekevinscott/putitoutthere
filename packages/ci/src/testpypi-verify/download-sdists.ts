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

import { execFileSync } from 'node:child_process';

import { errorMessage } from './error-message.js';
import { findSdistHref } from './find-sdist-href.js';
import { normalizeIndexUrl } from './normalize-index-url.js';
import { parseRequirement } from './parse-requirement.js';
import { parseSimpleIndexHrefs } from './parse-simple-index.js';
import { retrySleepSeconds } from './retry-sleep.js';
import { sdistFilenameFromHref } from './sdist-filename.js';

const SDISTS_DIR = 'downloaded-sdists';
const MAX_ATTEMPTS = 6;

export function downloadSdists(requirements: readonly string[], indexUrl: string): number {
  const indexNorm = normalizeIndexUrl(indexUrl);
  for (const requirement of requirements) {
    const { package: pkg, version } = parseRequirement(requirement);
    const projectUrl = `${indexNorm}${pkg}/`;
    const expectedSuffix = `-${version}.tar.gz`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const html = execFileSync('curl', ['-fsS', projectUrl], { encoding: 'utf8' });
        const href = findSdistHref(parseSimpleIndexHrefs(html), expectedSuffix);
        if (href === null) {
          throw new Error(`no sdist ending ${expectedSuffix} on ${projectUrl}`);
        }
        const artifactUrl = new URL(href, projectUrl).toString();
        process.stdout.write(`Downloading sdist for ${requirement} from ${artifactUrl}\n`);
        execFileSync('curl', ['-fsS', '-o', `${SDISTS_DIR}/${sdistFilenameFromHref(href)}`, artifactUrl], {
          stdio: 'ignore',
        });
        break;
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          process.stderr.write(`failed to download sdist for ${requirement}: ${errorMessage(error)}\n`);
          return 1;
        }
        const sleepFor = retrySleepSeconds(attempt);
        process.stdout.write(`TestPyPI sdist index lag for ${requirement}; retrying in ${sleepFor}s\n`);
        execFileSync('sleep', [String(sleepFor)], { stdio: 'ignore' });
      }
    }
  }
  return 0;
}
