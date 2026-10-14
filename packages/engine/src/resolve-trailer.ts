import { commitBody, commitParents } from './git.js';
import { parseTrailer, type Trailer } from './trailer.js';

/**
 * Read the release trailer starting from `head`. If `head` carries no
 * trailer but is a merge commit, fall back to the non-first-parent — by
 * GitHub convention that's the feature branch tip whose commit message
 * the operator actually wrote the trailer into. Without this fallback,
 * merge-commit merges silently strand every release.
 */
export async function resolveTrailer(head: string, cwd: string): Promise<Trailer | null> {
  const direct = parseTrailer(await commitBody(head, { cwd }));
  if (direct) {return direct;}
  const parents = await commitParents(head, { cwd });
  for (const sha of parents.slice(1)) {
    const t = parseTrailer(await commitBody(sha, { cwd }));
    if (t) {return t;}
  }
  return null;
}
