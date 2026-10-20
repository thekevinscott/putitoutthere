import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

export async function diffNames(
  from: string,
  to: string,
  opts: GitOptions = {},
): Promise<string[]> {
  const out = await runGit(['diff', '--name-only', `${from}..${to}`], opts);
  return out.split('\n').filter((l) => l.length > 0);
}
