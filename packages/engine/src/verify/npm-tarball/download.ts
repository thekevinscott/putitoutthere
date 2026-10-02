/**
 * Download a published npm tarball and extract it, returning the unpacked
 * `package/` directory (#443). `curl --retry 5 --retry-all-errors` absorbs the
 * tarball-blob CDN race: a cold-edge miss is an HTTP 404, which curl's default
 * `--retry` ignores, so `--retry-all-errors` is load-bearing (PR #323).
 */

import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execCapture } from '../../utils/exec-capture.js';

export interface ExtractedTarball {
  /** Temp dir to `rm` when done. */
  root: string;
  /** The unpacked `package/` directory inside the tarball. */
  packageDir: string;
}

export async function downloadNpmTarball(url: string, retryDelay: number): Promise<ExtractedTarball> {
  const root = await mkdtemp(join(tmpdir(), 'piot-tarball-'));
  const tgz = join(root, 'pkg.tgz');
  const extracted = join(root, 'extracted');
  await execCapture('curl', [
    '-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', String(retryDelay), '-o', tgz, url,
  ]);
  await mkdir(extracted);
  await execCapture('tar', ['-xzf', tgz, '-C', extracted]);
  return { root, packageDir: join(extracted, 'package') };
}
