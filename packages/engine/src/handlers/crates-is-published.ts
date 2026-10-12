import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { crateNameFor, REGISTRY } from './crate-name-for.js';

export async function cratesIsPublished(
  pkg: { name: string; crate?: string },
  version: string,
  _ctx: Ctx,
): Promise<boolean> {
  const crateName = crateNameFor(pkg);
  const url = `${REGISTRY}/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT },
  });
  if (res.status === 200) {return true;}
  if (res.status === 404) {return false;}
  // 429 (rate limited) is transient: crates.io throttles routine reads, and a
  // TransientError is what withRetry keys on at the isPublished call site. A
  // plain Error carries no `status`, so it would hard-fail the publish instead
  // of retrying. #580.
  if (res.status === 429 || res.status >= 500) {
    throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
  }
  // Remaining 4xx (400/401/403/…) are hard, non-retryable errors — crates.io
  // returns 200/404 for this endpoint, so anything else is a genuine fault.
  throw new Error(`crates.io GET ${url} returned ${res.status}`);
}
