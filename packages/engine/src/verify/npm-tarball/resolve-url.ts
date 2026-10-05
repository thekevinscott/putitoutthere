/**
 * Resolve a published version's tarball URL from the immutable per-version
 * document (#716). The old path shelled out to `npm view`, which reads the
 * MUTABLE packument — a cache-fronted discovery view that can omit a version
 * the registry has already accepted. Three successful publishes lagged it by
 * 46s / 103s / 110s past a 320s budget, so the gate failed releases that had
 * shipped. Inferring publish state from a mutable view is the defect #642 and
 * #694 also were; the fix is the same, read the document for the exact
 * version. The retries below cover reads that did not complete, never a 404.
 */

import { npmVersionDocUrl } from './version-doc-url.js';
import { readNpmVersionDoc } from './read-version-doc.js';
import { sleep } from '../../utils/sleep.js';
import type { NpmTarballResolution } from './types.js';

export async function resolveNpmTarballUrl(
  name: string,
  version: string,
  registry?: string,
): Promise<NpmTarballResolution> {
  // Function scope, not module scope: a module-scope ladder reads as a static
  // constant to the mutation gate and its mutants become unkillable.
  const sleeps = [2, 5, 10, 20, 30];
  const attempts = sleeps.length + 1;
  const url = npmVersionDocUrl(name, version, registry);

  for (let attempt = 1; ; attempt++) {
    const read = await readNpmVersionDoc(url);
    if (read.status === 'found') {return { status: 'found', url: read.tarball };}
    if (read.status === 'missing') {
      return {
        status: 'failed',
        reason: `${url} returned 404. That document is immutable and written at publish time, so this version was never published — waiting does not change the answer.`,
      };
    }
    if (read.status === 'untarballed') {
      return { status: 'failed', reason: `${url} carries no dist.tarball, so there is nothing to download.` };
    }
    if (attempt === attempts) {
      return {
        status: 'failed',
        reason: `could not read ${url} after ${attempts} attempts; last failure: ${read.detail}.`,
      };
    }
    const secs = sleeps[attempt - 1]!;
    process.stdout.write(
      `  registry read failed (attempt ${attempt}/${attempts}): ${read.detail}; retrying in ${secs}s\n`,
    );
    await sleep(secs * 1000);
  }
}
