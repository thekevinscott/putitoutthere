/**
 * `putitoutthere release-github` — cut a GitHub Release for each new tag on HEAD
 * (#444, #437). Never `git fetch`: a blanket `git fetch --tags` would reject a
 * tag moved since checkout and fail the job after a fully successful publish
 * (#436). Pushes are ref-scoped per tag (#407); creation is idempotent.
 */

import { pushTagRef, tagsPointingAtHead } from '../git.js';
import { ghReleaseCreate } from './gh-release-create.js';
import { ghReleaseExists } from './gh-release-exists.js';
import type { ReleaseGithubOptions } from './types.js';

export async function releaseGithub(opts: ReleaseGithubOptions): Promise<number> {
  const gitOpts = { cwd: opts.cwd };
  const tags = await tagsPointingAtHead(gitOpts);
  if (tags.length === 0) {
    process.stdout.write('No tags on HEAD; nothing to release on GitHub.\n');
    return 0;
  }
  for (const tag of tags) {
    await pushTagRef(tag, gitOpts);
    if (await ghReleaseExists(tag, gitOpts)) {
      process.stdout.write(`GitHub Release ${tag} already exists; skipping.\n`);
      continue;
    }
    await ghReleaseCreate(tag, gitOpts);
    process.stdout.write(`Created GitHub Release for ${tag}\n`);
  }
  return 0;
}
