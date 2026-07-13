/**
 * Read a file's bytes as UTF-8, returning null when it does not exist. Mirrors
 * the cargo-registry bash's `cat "$f" 2>/dev/null` (suppress the missing-file
 * error) used in the start-failure log dump and the diagnostic dump.
 */

import { readFileSync } from 'node:fs';

export function readRaw(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
