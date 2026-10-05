/**
 * Diagnostic string for a declared `files[]` directory missing from a published
 * tarball: is it present in the local source tree, and with how many files?
 * (#443) Present-locally-but-absent-in-tarball is the cachetta 0.3.x
 * fingerprint — the build produced the dir, the publish shipped without it.
 */

import { stat } from 'node:fs/promises';

import { listFilesRecursive } from '../../utils/list-files-recursive.js';
import { pathExists } from '../../utils/path-exists.js';

export async function localDirState(localPath: string): Promise<string> {
  if ((await pathExists(localPath)) && (await stat(localPath)).isDirectory()) {
    const files = await listFilesRecursive(localPath);
    return `local ${localPath}: present, ${files.length} file(s) — ${files.join(' ')} `;
  }
  return `local ${localPath}: missing`;
}
