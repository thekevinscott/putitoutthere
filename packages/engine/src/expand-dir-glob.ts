import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { matchesGlob } from './glob.js';
import { pathExists } from './utils/path-exists.js';

/**
 * Expand a relative path glob against the filesystem, returning the
 * directories it matches. Mirrors how cargo resolves `[workspace].members`
 * entries: a literal entry (no glob metacharacter) resolves to a single
 * path returned whether or not it exists — callers handle a missing
 * directory — while a glob entry is matched one path segment at a time
 * against the real directory tree, so only existing directories come back.
 */
export async function expandDirGlob(baseDir: string, pattern: string): Promise<string[]> {
  const globMeta = /[*?[\]{}]/;
  const segments = pattern.split('/').filter((s) => s.length > 0);
  let dirs = [baseDir];
  for (const segment of segments) {
    if (!globMeta.test(segment)) {
      dirs = dirs.map((d) => join(d, segment));
      continue;
    }
    // Sequential expansion (no Promise.all): matches the prior flatMap
    // order — readdir order within each dir, dirs in their existing order.
    const next: string[] = [];
    for (const d of dirs) {
      if (!(await pathExists(d))) {continue;}
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory() && matchesGlob(segment, e.name)) {
          next.push(join(d, e.name));
        }
      }
    }
    dirs = next;
  }
  return dirs;
}
