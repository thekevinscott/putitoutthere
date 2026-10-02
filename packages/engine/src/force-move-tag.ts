/**
 * Force-move a tag to a commit, locally and on the remote — the shared
 * tag-move both floating-tag advancers use (#446, epic #442). The push is
 * ref-scoped (`refs/tags/<name>`) so it touches no other tag; force is
 * intrinsic, since a floating tag's remote update is a non-fast-forward.
 */

import { forceTag, type GitOptions, pushTagRefForce } from './git.js';

export async function forceMoveTag(name: string, target: string, opts: GitOptions = {}): Promise<void> {
  await forceTag(name, target, opts);
  await pushTagRefForce(name, opts);
}
