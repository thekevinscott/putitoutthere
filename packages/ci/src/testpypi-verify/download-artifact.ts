/**
 * Fetch one published artifact to `dest` by its immutable
 * `test-files.pythonhosted.org` URL, retrying transport failures under the
 * shared budget. `true` when the file landed.
 *
 * These URLs are content-addressed and never change, so a failure here is a
 * network fault rather than a registry-state question — which is why the
 * retry line says so instead of blaming the index.
 */

import { execCapture } from '../utils/exec-capture.js';
import { sleep } from '../utils/sleep.js';
import { errorMessage } from './error-message.js';
import { MAX_ATTEMPTS, retrySleepSeconds } from './retry-sleep.js';

export async function downloadArtifact(url: string, dest: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await execCapture('curl', ['-fsS', '-o', dest, url]);
      return true;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        process.stderr.write(`download failed for ${url}: ${errorMessage(error)}\n`);
      } else {
        const sleepFor = retrySleepSeconds(attempt);
        process.stdout.write(`download failed for ${url}; retrying in ${sleepFor}s\n`);
        await sleep(sleepFor * 1000);
      }
    }
  }
  return false;
}
