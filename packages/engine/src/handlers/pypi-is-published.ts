import type { Ctx } from '../types.js';
import { TransientError } from '../types.js';
import { USER_AGENT } from '../version.js';
import { pypiNameFor } from './pypi-name-for.js';

export async function pypiIsPublished(
  pkg: { name: string; pypi?: string },
  version: string,
  _ctx: Ctx,
): Promise<boolean> {
  const name = pypiNameFor(pkg);
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT },
  });
  if (res.status === 200) {return true;}
  if (res.status === 404) {return false;}
  // 429 (rate limited) is transient: PyPI throttles routine reads, and a
  // TransientError is what withRetry keys on at the isPublished call site. A
  // plain Error carries no `status`, so it would hard-fail the publish instead
  // of retrying. #580.
  if (res.status === 429 || res.status >= 500) {
    throw new TransientError(`pypi.org GET ${url} returned ${res.status}`);
  }
  // Remaining 4xx (400/401/403/…) are hard, non-retryable errors — PyPI
  // returns 200/404 for this endpoint, so anything else is a genuine fault.
  throw new Error(`pypi.org GET ${url} returned ${res.status}`);
}
