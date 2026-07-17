/**
 * Force-move a tag to a commit, on the local repo and the remote — the one
 * shared tag-move both floating-tag advancers use (#446, epic #442).
 *
 * The repo previously carried this two-line sequence twice in inline bash:
 * `release-npm.yml`'s "Move floating major tag" (advancing `v<major>` to
 * the latest release) and `advance-v0.yml`'s "Force-move v0" (advancing
 * `v0` to HEAD). Consolidating them here means the local-tag write and the
 * ref-scoped force-push can never disagree between the two sites.
 *
 * `git tag -f` overwrites the local tag; `git push --force origin
 * refs/tags/<name>` publishes that move, ref-scoped so it touches no other
 * tag. Force is intrinsic — a floating tag by definition moves, so the
 * remote update is a non-fast-forward the push must be allowed to make.
 */

import { forceTag, type GitOptions, pushTagRefForce } from './git.js';

export async function forceMoveTag(name: string, target: string, opts: GitOptions = {}): Promise<void> {
  await forceTag(name, target, opts);
  await pushTagRefForce(name, opts);
}
