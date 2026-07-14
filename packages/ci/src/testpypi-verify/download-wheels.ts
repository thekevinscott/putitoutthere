/**
 * Composition root for the wheel-download phase of `testpypi-verify metadata`.
 * Reproduces the bash `while read req … python -m pip download …` loop: for
 * each requirement, announce it, then try `pip download` up to six times,
 * sleeping `attempt*10`s between failures, and fail with the exact
 * `::error::failed to download wheel …` line if all attempts fail. pip/sleep
 * run through the same subprocess boundary the bash used. Returns the exit
 * code (0 = all wheels downloaded).
 */

import { execFileSync } from 'node:child_process';

import { retrySleepSeconds } from './retry-sleep.js';

const WHEELS_DIR = 'downloaded-wheels';
const MAX_ATTEMPTS = 6;

export function downloadWheels(requirements: readonly string[], indexUrl: string): number {
  for (const requirement of requirements) {
    process.stdout.write(`Downloading wheel for ${requirement} from TestPyPI\n`);
    let downloaded = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        execFileSync(
          'python',
          [
            '-m',
            'pip',
            'download',
            '--index-url',
            indexUrl,
            '--no-deps',
            '--only-binary=:all:',
            '--dest',
            WHEELS_DIR,
            requirement,
          ],
          { stdio: 'inherit' },
        );
        downloaded = true;
        break;
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          const sleepFor = retrySleepSeconds(attempt);
          process.stdout.write(`TestPyPI wheel index lag for ${requirement}; retrying in ${sleepFor}s\n`);
          execFileSync('sleep', [String(sleepFor)], { stdio: 'ignore' });
        }
      }
    }
    if (!downloaded) {
      process.stdout.write(`::error::failed to download wheel for ${requirement} from TestPyPI\n`);
      return 1;
    }
  }
  return 0;
}
