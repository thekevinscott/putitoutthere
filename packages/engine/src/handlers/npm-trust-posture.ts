import { TransientError, type Ctx, type TrustPosture } from '../types.js';
import { USER_AGENT } from '../version.js';
import { npmNameFor, type NpmPkg } from './npm-name-for.js';

/**
 * Trust posture for a published npm version (#414). A `--provenance`
 * publish (the OIDC trusted-publisher path) writes a provenance
 * attestation; the public attestations endpoint returns 200 for it and
 * 404 when none exists (a plain token publish).
 */
export async function npmTrustPosture(pkg: NpmPkg, version: string, _ctx: Ctx): Promise<TrustPosture> {
  const name = npmNameFor(pkg);
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${name}@${version}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {return 'oidc';}
  if (res.status === 404) {return 'token';}
  throw new TransientError(`registry.npmjs.org GET ${url} returned ${res.status}`);
}
