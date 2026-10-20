import { commitFileSets } from './commit-file-sets.js';
import type { Package } from './config.js';
import { countTouchingCommits } from './count-touching-commits.js';
import { ensureTag } from './ensure-tag.js';
import { ErrorCodes } from './error-codes.js';
import { lastTag, remoteTagExists, tagList } from './git.js';
import { formatTag } from './tag-template.js';
import type { Logger } from './types.js';

export async function healPublishedTag(
  pkg: Package,
  packages: readonly Package[],
  version: string,
  head: string,
  opts: { cwd: string },
  log: Logger,
): Promise<void> {
  const tag = formatTag(pkg.tag_format, { name: pkg.name, version });
  if (await remoteTagExists(tag, opts)) {return;}
  if ((await tagList(tag, opts)).length === 0) {
    const last = await lastTag(pkg.name, pkg.tag_format, opts);
    const touching = countTouchingCommits(pkg.name, packages, await commitFileSets(last?.tag ?? null, opts));
    if (touching > 1) {
      throw new Error(
        `[${ErrorCodes.HEAL_UNRELEASED_CHANGES}] ${pkg.name}@${version} is live on the registry but untagged, ` +
          `and HEAD has unreleased changes: ${touching} commits since ${last?.tag ?? 'the first commit'} touch ` +
          `${pkg.name}, so the published commit cannot be told apart from later ones, and tagging HEAD would ` +
          `mark unreleased code as ${version}. Tag the commit that was actually published, by hand ` +
          `(\`git tag -a ${tag} <sha> && git push origin ${tag}\`) or by running ` +
          `\`putitoutthere reconcile --expect ${pkg.name}@${version}\` from a checkout of that commit, then rerun.`,
      );
    }
  }
  await ensureTag(pkg.tag_format, pkg.name, version, head, opts, log);
}
