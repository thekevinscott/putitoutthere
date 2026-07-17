/**
 * Read a file's bytes as UTF-8, returning null when it does not exist. Mirrors
 * the cargo-registry bash's `cat "$f" 2>/dev/null` (suppress the missing-file
 * error) used in the start-failure log dump and the diagnostic dump.
 */

import { readFile } from 'node:fs/promises';

export async function readRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
