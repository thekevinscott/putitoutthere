/**
 * The first regular file directly under `dir` whose name ends with `ext`, or
 * null when none exists (#450). Non-recursive — the analogue of the bash
 * `find "$dist_dir" -maxdepth 1 -name '*<ext>' -print -quit`. Sorted for a
 * deterministic pick when a dist dir holds more than one match.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function findDistFile(dir: string, ext: string): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith(ext)) {
      const full = join(dir, name);
      if (statSync(full).isFile()) {
        return full;
      }
    }
  }
  return null;
}
