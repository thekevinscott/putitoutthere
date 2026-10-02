/**
 * Depth-first search for the first of `candidates` under `dir` that is an
 * actual file, as a **posix** path relative to `dir` (#626) — a build step may
 * stage a payload flat or nested, and the result lands in `package.json#main`,
 * so a back-slashed `join` would ship a manifest that only resolves on Windows.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function firstFileUnder(
  dir: string,
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const name of candidates) {
    const full = join(dir, name);
    // Anything that is not a directory — a regular file, a symlink to one,
    // a fifo — is as far as the descent can go, so it is the answer.
    if (!(await stat(full)).isDirectory()) {
      return name;
    }
    const nested = await firstFileUnder(full, await readdir(full));
    if (nested !== undefined) {
      return `${name}/${nested}`;
    }
  }
  return undefined;
}
