import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

/**
 * The tags whose commit is HEAD — `git tag --points-at HEAD`. Lists exactly
 * the tags the engine just created on this commit, with no fetch and no
 * remote dependency (#444). Empty array when HEAD carries no tag.
 */
export async function tagsPointingAtHead(opts: GitOptions = {}): Promise<string[]> {
  const out = await runGit(['tag', '--points-at', 'HEAD'], opts);
  return out.split('\n').filter((l) => l.length > 0);
}
