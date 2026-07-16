/**
 * Absolute paths of every regular file under `dir`, recursively. The
 * async analogue of the `find "$dir" -type f` the extracted bash
 * used for both the tarball-content file counts and the local-state
 * diagnostics (#443).
 *
 * Returns `[]` for a missing path, mirroring `find`'s tolerance
 * (`2>/dev/null`).
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { pathExists } from './path-exists.js';

export async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) {return [];}
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}
