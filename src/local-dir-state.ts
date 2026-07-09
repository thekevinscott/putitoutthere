/**
 * Diagnostic string for a declared `files[]` directory that is missing
 * from a published tarball: is it present in the local source tree, and
 * with how many files? (#443)
 *
 * A present-locally-but-absent-in-tarball state is the fingerprint of the
 * cachetta 0.3.x bug — the build produced the dir, the publish shipped
 * without it. Absent locally points at a different misconfiguration. The
 * string is appended to the tarball-missing `::error::`.
 */

import { existsSync, statSync } from 'node:fs';

import { listFilesRecursive } from './list-files-recursive.js';

export function localDirState(localPath: string): string {
  if (existsSync(localPath) && statSync(localPath).isDirectory()) {
    const files = listFilesRecursive(localPath);
    return `local ${localPath}: present, ${files.length} file(s) — ${files.join(' ')} `;
  }
  return `local ${localPath}: missing`;
}
