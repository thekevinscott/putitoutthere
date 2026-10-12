import { TransientError, type Ctx, type TrustPosture } from '../types.js';
import { USER_AGENT } from '../version.js';
import { crateNameFor, REGISTRY } from './crate-name-for.js';

/**
 * Trust posture for a published crate version (#414). crates.io's version
 * endpoint exposes `trustpub_data` ({provider, repository, …}) when the
 * version was published via Trusted Publishing (OIDC); a token publish
 * leaves it null and names a `published_by` user.
 */
export async function cratesTrustPosture(
  pkg: { name: string; crate?: string },
  version: string,
  _ctx: Ctx,
): Promise<TrustPosture> {
  const crateName = crateNameFor(pkg);
  const url = `${REGISTRY}/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { version?: { trustpub_data?: unknown } };
    return body.version?.trustpub_data ? 'oidc' : 'token';
  }
  throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
}
