import type { Ctx } from '../types.js';
import { TransientError } from '../types.js';
import { USER_AGENT } from '../version.js';
import { pypiNameFor } from './pypi-name-for.js';

/**
 * Latest published version of the project, or null when it has never
 * been published (404). GET /pypi/{name}/json → `info.version`. Reuses
 * `pypiNameFor` so this read resolves the PyPI name exactly as
 * `isPublished` / `publish` do. Any non-200/404 is surfaced as a
 * TransientError; the read-only caller renders that as "unreachable".
 */
export async function pypiLatestVersion(
  pkg: { name: string; pypi?: string },
  _ctx: Ctx,
): Promise<string | null> {
  const name = pypiNameFor(pkg);
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  const res = await fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
  if (res.status === 200) {
    const body = (await res.json()) as { info?: { version?: string } };
    return body.info?.version ?? null;
  }
  if (res.status === 404) {return null;}
  throw new TransientError(`pypi.org GET ${url} returned ${res.status}`);
}
