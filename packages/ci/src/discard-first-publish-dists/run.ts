import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { droppedWarning, isFirstPublishArtifact } from './decide.js';

export async function runDiscardFirstPublishDists(): Promise<number> {
  const entries = await readdir('dist', { withFileTypes: true }).catch(() => []);
  const dropped = entries.filter((e) => e.isFile() && isFirstPublishArtifact(e.name)).map((e) => e.name);
  for (const name of dropped) {
    await rm(join('dist', name));
    process.stdout.write(`  dropped: ${name}\n`);
  }
  if (dropped.length > 0) {process.stdout.write(`${droppedWarning(dropped.length)}\n`);}
  return 0;
}
