import { withRetry } from './retry.js';
import type { Logger } from './types.js';
import { sleep } from './utils/sleep.js';

export async function awaitPublished(
  isPublished: () => Promise<boolean>,
  label: string,
  log: Logger,
  sleeps: readonly number[] = [5, 10, 15, 30, 60, 60],
): Promise<boolean> {
  for (const secs of sleeps) {
    if (await withRetry(isPublished)) {return true;}
    log.info(`${label} not visible on the registry yet; retrying in ${secs}s`);
    await sleep(secs * 1000);
  }
  return withRetry(isPublished);
}
