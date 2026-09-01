/**
 * Composition root for resolving one requirement's published artifacts. Polls
 * the version-pinned release-metadata URL under the shared retry budget and
 * returns the files it lists, or the `::error::` line that names why it could
 * not.
 *
 * The budget still exists because a read replica can trail an accepted upload
 * by seconds — but the terminal message no longer conflates the two states the
 * old `/simple/` poll could not tell apart (#668): a 404 that outlives the
 * budget means the version is not on TestPyPI at all, which is a broken
 * publish, not a slow index. It stays bounded either way.
 */

import { sleep } from '../utils/sleep.js';
import { parseRequirement } from './parse-requirement.js';
import type { ReadReleaseFailure } from './read-release-files.js';
import { readReleaseFiles } from './read-release-files.js';
import { releaseJsonUrl } from './release-json-url.js';
import type { ReleaseFiles } from './release-file-types.js';
import { retryBudgetSeconds } from './retry-budget-seconds.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

export type ResolveReleaseResult = { files: ReleaseFiles } | { errorLine: string };

export async function resolveRelease(requirement: string, indexUrl: string): Promise<ResolveReleaseResult> {
  const { package: pkg, version } = parseRequirement(requirement);
  const url = releaseJsonUrl(indexUrl, pkg, version);
  if (url === null) {
    return { errorLine: `::error::testpypi-verify: TESTPYPI_INDEX_URL is not a URL (${indexUrl}).` };
  }
  let failure: ReadReleaseFailure = { notFound: false, reason: 'no attempt made' };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await readReleaseFiles(url);
    if ('files' in result) {
      return { files: result.files };
    }
    failure = result.failure;
    if (attempt < MAX_ATTEMPTS) {
      const sleepFor = retrySleepSeconds(attempt);
      process.stdout.write(
        `TestPyPI has no release metadata for ${requirement} yet (${failure.reason}); retrying in ${sleepFor}s\n`,
      );
      await sleep(sleepFor * 1000);
    }
  }
  const budget = retryBudgetSeconds();
  return {
    errorLine: failure.notFound
      ? `::error::${requirement} is not published to TestPyPI: ${url} returned 404 for the full ${budget}s budget`
      : `::error::could not read TestPyPI release metadata for ${requirement} from ${url} after ${budget}s: ${failure.reason}`,
  };
}
