/**
 * One read of npm's per-version document (#716). Four outcomes, because the
 * caller's next move differs for each: `found` is done, `untarballed` is the
 * registry answering completely and wrongly, `missing` is its 404 — which
 * right after a publish means not-yet-consistent rather than not-published —
 * and `unreadable` is a read that never completed. The last two are the ones
 * another read can change.
 */

import type { NpmVersionDocRead } from './types.js';
import { USER_AGENT } from '../../version.js';

export async function readNpmVersionDoc(url: string): Promise<NpmVersionDocRead> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) {return { status: 'missing' };}
    if (res.status !== 200) {return { status: 'unreadable', detail: `HTTP ${res.status}` };}
    const doc = (await res.json()) as { dist?: { tarball?: string } };
    const tarball = doc.dist?.tarball;
    return tarball ? { status: 'found', tarball } : { status: 'untarballed' };
  } catch (err) {
    return { status: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
}
