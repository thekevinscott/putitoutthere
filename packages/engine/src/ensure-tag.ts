/**
 * Auto-heal a missing release tag (#407). A half-failed earlier run can leave
 * a version published but untagged, which strands the package — piot derives
 * "last released" from tags. Writes and pushes the tag at `commit` when
 * `origin` does not have it yet. Runs on both the fresh-publish and
 * already-published branches.
 *
 * Idempotency is checked against the remote, not local tags (#717): a run
 * that created the tag locally and then failed to push it leaves a local
 * tag with nothing on `origin`. Checking `tagList` (local-only) would read
 * that as "already done" and never retry the push — "tried and failed"
 * would be indistinguishable from "succeeded" for the rest of that working
 * tree's life. A push failure now propagates instead of being downgraded to
 * a warning, for the same reason: `publish` and `reconcile` must not report
 * success for a version the remote has no tag for.
 */

import { ErrorCodes } from './error-codes.js';
import { createTag, pushTag, remoteTagExists, tagList } from './git.js';
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
  if (await remoteTagExists(tagName, opts)) {return;}
  if ((await tagList(tagName, opts)).length === 0) {
    await createTag(tagName, commit, { cwd: opts.cwd, message: `Release ${tagName}` });
  }
  log.info(`publish: pushing tag ${tagName}`);
  try {
    await pushTag(tagName, opts);
  } catch (err) {
    throw new Error(
      `[${ErrorCodes.TAG_PUSH_FAILED}] ${name}@${version} is on the registry, but pushing tag ` +
        `${tagName} failed: ${err instanceof Error ? err.message : String(err)}. The registry ` +
        `write already happened — do not re-run publish for this version. Fix the push problem ` +
        `(origin, auth, a diverged remote tag) and rerun \`putitoutthere reconcile\`, which ` +
        `backfills the tag without re-publishing.`,
      { cause: err },
    );
  }
}
