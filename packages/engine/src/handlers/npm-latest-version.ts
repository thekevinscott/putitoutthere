import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { npmNameFor, type NpmPkg } from './npm-name-for.js';

/**
 * Latest published version of the package, or null when it has never
 * been published (404). GET registry.npmjs.org/{name} (the packument) →
 * `dist-tags.latest`. Reuses `npmNameFor` and the same scoped-name
 * encoding as the bootstrap probe, so this read resolves the npm name
 * exactly as `isPublished` / `publish` do. Any non-200/404 is surfaced
 * as a TransientError; the read-only caller renders that as
 * "unreachable". Unlike `isPublished` (which shells out to `npm view`),
 * this uses a plain unauthenticated GET — `status` needs no npm CLI.
 */
export async function npmLatestVersion(pkg: NpmPkg, _ctx: Ctx): Promise<string | null> {
  const name = npmNameFor(pkg);
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replaceAll('%40', '@')}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { 'dist-tags'?: { latest?: string } };
    return body['dist-tags']?.latest ?? null;
  }
  if (res.status === 404) {return null;}
  throw new TransientError(`registry.npmjs.org GET ${url} returned ${res.status}`);
}
