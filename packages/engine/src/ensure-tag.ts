/**
 * Auto-heal a missing release tag (#407). When a version is confirmed
 * live on the registry, its git tag must exist — a half-failed earlier
 * run can leave a version published but untagged, which strands the
 * package (piot derives "last released" from tags). This writes the tag
 * if it's missing, at `commit`. Idempotent: a no-op when the tag is
 * already there.
 *
 * Used on both publish paths — right after a fresh publish, and on the
 * already-published skip branch (the heal). `reconcile` (#403) will reuse
 * it to backfill already-stuck packages.
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
