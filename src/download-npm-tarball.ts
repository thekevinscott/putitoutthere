/**
 * Download a published npm tarball and extract it, returning the path to
 * the unpacked `package/` directory (#443).
 *
 * `curl --retry 5 --retry-all-errors` absorbs the tarball-blob CDN race
 * that is independent of the packument race `resolveNpmTarballUrl` handles:
 * a cold-edge tarball miss surfaces as HTTP 404, which curl's default
 * `--retry` ignores, so `--retry-all-errors` is load-bearing (PR #323).
 * `retryDelay` seconds matches the call site's original schedule.
 *
 * Caller owns cleanup of the returned `root`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ExtractedTarball {
  /** Temp dir to `rmSync` when done. */
  root: string;
  /** The unpacked `package/` directory inside the tarball. */
  packageDir: string;
}

export function downloadNpmTarball(url: string, retryDelay: number): ExtractedTarball {
  const root = mkdtempSync(join(tmpdir(), 'piot-tarball-'));
  const tgz = join(root, 'pkg.tgz');
  const extracted = join(root, 'extracted');
  execFileSync('curl', [
    '-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', String(retryDelay), '-o', tgz, url,
  ]);
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', tgz, '-C', extracted]);
  return { root, packageDir: join(extracted, 'package') };
}
