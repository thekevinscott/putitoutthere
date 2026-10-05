/**
 * Resolve a published version's tarball URL from the per-version document
 * (#716). The old path shelled out to `npm view`, which reads the MUTABLE
 * packument — `GET /<name>`, which npm serves `cache-control: public,
 * max-age=300`. The read taken a second after a publish caches a copy that
 * omits the new version, and every read for the next five minutes is served
 * that same copy, so a 320s budget was spent re-asking one stale snapshot;
 * three publishes landed 46s / 103s / 110s the wrong side of it.
 * `GET /<name>/<version>` is uncached (`cf-cache-status: DYNAMIC`), so each
 * attempt here sees current registry state instead.
 *
 * Current state is still not instant: four live publishes answered 404 on
 * this endpoint within a second of `npm publish` reporting success. So a 404
 * is retried, which is sound only because the caller is the run that just
 * published this exact `name@version` — for a discovery read the same 404 is
 * also the correct permanent answer and no budget can tell the two apart,
 * which is the ambiguity #694 had to route around.
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
  const sleeps = [2, 5, 10, 20, 30, 60, 60, 60, 60];
  const attempts = sleeps.length + 1;
  const url = npmVersionDocUrl(name, version, registry);

  for (let attempt = 1; ; attempt++) {
    const read = await readNpmVersionDoc(url);
    if (read.status === 'found') {return { status: 'found', url: read.tarball };}
    // A 200 naming no tarball is the registry answering completely; it has
    // nothing left to converge on, so retrying only repeats the answer.
    if (read.status === 'untarballed') {
      return { status: 'failed', reason: `${url} carries no dist.tarball, so there is nothing to download.` };
    }
    const why = read.status === 'missing' ? 'HTTP 404' : read.detail;
    if (attempt === attempts) {
      return {
        status: 'failed',
        reason: `${url} did not resolve after ${attempts} attempts; last read: ${why}. Either the publish did not reach the registry, or propagation exceeded the budget.`,
      };
    }
    const secs = sleeps[attempt - 1]!;
    process.stdout.write(
      `  registry read did not resolve (attempt ${attempt}/${attempts}): ${why}; retrying in ${secs}s\n`,
    );
    await sleep(secs * 1000);
  }
}
