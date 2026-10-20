import type { GitOptions } from './git.js';
import { runGit } from './run-git.js';

export async function commitFileSets(base: string | null, opts: GitOptions = {}): Promise<string[][]> {
  const range = base === null ? 'HEAD' : `${base}..HEAD`;
  const out = await runGit(['log', '--format=%x1e', '--name-only', range], opts);
  return out
    .split('\x1e')
    .slice(1)
    .map((record) => record.split('\n').filter((line) => line !== ''));
}
