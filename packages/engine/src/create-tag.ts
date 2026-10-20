import type { GitOptions } from './git-types.js';
import { runGit } from './run-git.js';

interface TagOptions extends GitOptions {
  message?: string;
}

export async function createTag(
  name: string,
  sha: string,
  opts: TagOptions = {},
): Promise<void> {
  const message = opts.message ?? name;
  await runGit(['tag', '-a', '-m', message, name, sha], opts);
}
