import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

/**
 * Whether the index holds staged changes — `git diff --cached --quiet`
 * exits non-zero when there are. Returns `true` when something is staged,
 * `false` on a clean index. Used to guard the fold against committing
 * nothing when `build:action` produced no bundle output.
 */
export async function hasStagedChanges(opts: GitOptions = {}): Promise<boolean> {
  try {
    await runGit(['diff', '--cached', '--quiet'], opts);
    return false;
  } catch {
    return true;
  }
}
