/**
 * The first regular file directly under `dir` whose name ends with `ext`, or
 * null when none exists (#450). Non-recursive — the analogue of the bash
 * `find "$dist_dir" -maxdepth 1 -name '*<ext>' -print -quit`. Sorted for a
 * deterministic pick when a dist dir holds more than one match.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { pathExists } from '../../utils/path-exists.js';

export async function findDistFile(dir: string, ext: string): Promise<string | null> {
  if (!(await pathExists(dir))) {
    return null;
  }
  for (const name of (await readdir(dir)).sort()) {
    if (name.endsWith(ext)) {
      const full = join(dir, name);
      if ((await stat(full)).isFile()) {
        return full;
      }
    }
  }
  return null;
}
