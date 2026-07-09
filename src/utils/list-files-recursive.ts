/**
 * Absolute paths of every regular file under `dir`, recursively. The
 * synchronous analogue of the `find "$dir" -type f` the extracted bash
 * used for both the tarball-content file counts and the local-state
 * diagnostics (#443).
 *
 * Returns `[]` for a missing path, mirroring `find`'s tolerance
 * (`2>/dev/null`).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) {return [];}
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}
