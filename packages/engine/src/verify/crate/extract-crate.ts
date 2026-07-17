/**
 * Extract a `.crate` (a gzipped tar) into a fresh temp dir and return it
 * (#449). Caller owns cleanup. The real `tar -xzf` mirrors the bash.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execCapture } from '../../utils/exec-capture.js';

export async function extractCrate(crateFile: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piot-crate-'));
  await execCapture('tar', ['-xzf', crateFile, '-C', dir]);
  return dir;
}
