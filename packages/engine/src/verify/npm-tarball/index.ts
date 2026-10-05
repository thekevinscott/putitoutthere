/**
 * `putitoutthere verify npm-tarball` — assert a published npm tarball honors the
 * shape it declared (#443, epic #442). Default mode verifies the main/noarch
 * `package.json` `files[]` dirs are in the tarball; `--per-triple` verifies a
 * platform package ships a non-`package.json` file. Downloads each back.
 */

import { verifyNpmTarballMain } from './main.js';
import { verifyNpmTarballTriple } from './triple.js';
import type { TarballRow, VerifyNpmTarballOptions } from './types.js';

export async function verifyNpmTarball(opts: VerifyNpmTarballOptions): Promise<number> {
  const rows = JSON.parse(opts.matrix) as TarballRow[];
  return opts.perTriple ? verifyNpmTarballTriple(rows, opts) : verifyNpmTarballMain(rows, opts);
}
