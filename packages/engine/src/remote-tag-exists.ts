import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

/**
 * Whether `origin` already carries this tag — `git ls-remote --tags origin
 * refs/tags/<name>`. The only source of truth `ensureTag` (#407) can use for
 * "already done": `tagList` is local-only, so a tag created but never
 * successfully pushed reads as present there even though `origin` has
 * nothing, which is exactly the state a failed push leaves behind (#717).
 */
export async function remoteTagExists(name: string, opts: GitOptions = {}): Promise<boolean> {
  // `runGit` already trimEnds; no further trimming needed to tell empty from non-empty.
  const out = await runGit(['ls-remote', '--tags', 'origin', `refs/tags/${name}`], opts);
  return out.length > 0;
}
