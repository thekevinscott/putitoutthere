import type { Ctx, TrustPosture } from '../types.js';
import { TransientError } from '../types.js';
import { USER_AGENT } from '../version.js';
import { pypiNameFor } from './pypi-name-for.js';

/**
 * Trust posture for a published PyPI version (#414). PyPI exposes
 * PEP 740 attestations per file at `/integrity/{p}/{v}/{file}/provenance`
 * (200 when a trusted-publisher attestation exists, 404 when none). The
 * file list comes from the per-version JSON.
 */
export async function pypiTrustPosture(
  pkg: { name: string; pypi?: string },
  version: string,
  _ctx: Ctx,
): Promise<TrustPosture> {
  const name = pypiNameFor(pkg);
  const jsonUrl = `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
  const jsonRes = await fetch(jsonUrl, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (jsonRes.status !== 200) {
    throw new TransientError(`pypi GET ${jsonUrl} returned ${jsonRes.status}`);
  }
  const body = (await jsonRes.json()) as { urls?: Array<{ filename?: string }> };
  const filename = body.urls?.[0]?.filename;
  // A published version with no files can carry no attestation.
  if (filename === undefined) {return 'token';}
  const provUrl = `https://pypi.org/integrity/${encodeURIComponent(name)}/${encodeURIComponent(version)}/${encodeURIComponent(filename)}/provenance`;
  const provRes = await fetch(provUrl, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (provRes.status === 200) {return 'oidc';}
  if (provRes.status === 404) {return 'token';}
  throw new TransientError(`pypi GET ${provUrl} returned ${provRes.status}`);
}
