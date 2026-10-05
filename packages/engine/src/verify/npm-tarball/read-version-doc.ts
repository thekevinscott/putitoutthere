/**
 * One read of npm's per-version document (#716). A 404 here is the registry's
 * verdict, not a cache miss: the document exists from the moment the publish
 * is accepted. So only a read that did not COMPLETE is `unreadable`, and that
 * is the single outcome a retry can change.
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
