import { withRetry } from './retry.js';
import type { Logger } from './types.js';
import { sleep } from './utils/sleep.js';

export const PUBLISH_VISIBILITY_SLEEPS_S = [5, 10, 15, 30, 60, 60];

export async function awaitPublished(
  isPublished: () => Promise<boolean>,
  label: string,
  log: Logger,
  sleeps: readonly number[] = PUBLISH_VISIBILITY_SLEEPS_S,
): Promise<boolean> {
  for (const secs of sleeps) {
    if (await withRetry(isPublished)) {return true;}
    log.info(`${label} not visible on the registry yet; retrying in ${secs}s`);
    await sleep(secs * 1000);
  }
  return withRetry(isPublished);
}
