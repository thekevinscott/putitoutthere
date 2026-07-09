/**
 * `putitoutthere verify npm-tarball` — assert a published npm tarball
 * honors the shape it declared (#443, epic #442).
 *
 * Extraction of the two inline bash blocks in
 * `.github/workflows/e2e-fixture-job.yml` into one tested engine command,
 * invoked from both former sites. Default mode verifies main/noarch
 * `package.json` `files[]` directories are present in the tarball;
 * `--per-triple` verifies synthesized platform packages ship a
 * non-`package.json` file.
 *
 * Reads the same plan matrix the workflow already carries; downloads each
 * tarball back from the registry (`npm view` → `curl` → `tar`) and inspects
 * it. Returns the process exit code (0 ok, 1 on any mismatch).
 */

import { verifyNpmTarballMain } from './verify-npm-tarball-main.js';
import { verifyNpmTarballTriple } from './verify-npm-tarball-triple.js';
import type { TarballRow, VerifyNpmTarballOptions } from './verify-npm-tarball-types.js';

export async function verifyNpmTarball(opts: VerifyNpmTarballOptions): Promise<number> {
  const rows = JSON.parse(opts.matrix) as TarballRow[];
  return opts.perTriple ? verifyNpmTarballTriple(rows, opts) : verifyNpmTarballMain(rows, opts);
}
