/**
 * Extract a `.crate` (a gzipped tar) into a fresh temp dir and return it
 * (#449). Caller owns cleanup. The real `tar -xzf` mirrors the bash.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function extractCrate(crateFile: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'piot-crate-'));
  execFileSync('tar', ['-xzf', crateFile, '-C', dir]);
  return dir;
}
