/**
 * Auto-heal a missing release tag (#407). A half-failed earlier run can leave
 * a version published but untagged, which strands the package — piot derives
 * "last released" from tags. Writes the tag at `commit` if missing;
 * idempotent. Runs on both the fresh-publish and already-published branches.
 */

import { createTag, pushTag, tagList } from './git.js';
import { formatTag } from './tag-template.js';
import type { Logger } from './types.js';

export async function ensureTag(
  tagFormat: string,
  name: string,
  version: string,
  commit: string,
  opts: { cwd: string },
  log: Logger,
): Promise<void> {
  const tagName = formatTag(tagFormat, { name, version });
  if ((await tagList(tagName, opts)).length > 0) {return;}
  await createTag(tagName, commit, { cwd: opts.cwd, message: `Release ${tagName}` });
  try {
    await pushTag(tagName, opts);
  } catch (err) {
    log.warn(
      `publish: failed to push tag ${tagName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
