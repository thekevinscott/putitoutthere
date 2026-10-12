import { TransientError, type Ctx } from '../types.js';
import { USER_AGENT } from '../version.js';
import { crateNameFor, cratesRegistry } from './crate-name-for.js';

/**
 * Latest published version of the crate, or null when it has never been
 * published (404). GET /api/v1/crates/{name} → `crate.newest_version`.
 * Reuses `crateNameFor` so this read resolves the crates.io name exactly
 * as `isPublished` / `publish` do. Any non-200/404 is surfaced as a
 * TransientError; the read-only caller renders that as "unreachable".
 */
export async function cratesLatestVersion(
  pkg: { name: string; crate?: string },
  _ctx: Ctx,
): Promise<string | null> {
  const crateName = crateNameFor(pkg);
  const url = `${cratesRegistry()}/api/v1/crates/${encodeURIComponent(crateName)}`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { crate?: { newest_version?: string } };
    return body.crate?.newest_version ?? null;
  }
  if (res.status === 404) {return null;}
  throw new TransientError(`crates.io GET ${url} returned ${res.status}`);
}
