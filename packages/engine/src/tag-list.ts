import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

export async function tagList(glob: string, opts: GitOptions = {}): Promise<string[]> {
  const out = await runGit(['tag', '-l', glob], opts);
  return out.split('\n').filter((l) => l.length > 0);
}
