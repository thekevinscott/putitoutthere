/**
 * `putitoutthere advance-v0` — force-move the floating `v0` tag to HEAD
 * (#446, epic #442).
 *
 * Extraction of `advance-v0.yml`'s inline "Force-move v0 to bundle commit"
 * bash. `v0` tracks main HEAD (not the latest release), so every push to
 * main advances it to a fresh bundle commit so
 * `uses: thekevinscott/putitoutthere@v0` resolves to a runnable action.
 * The workflow's Fold step (`fold-bundle`) synthesizes that commit first;
 * this then points `v0` at it.
 *
 * Reuses the shared `forceMoveTag` so the local `git tag -f` + ref-scoped
 * force-push match the floating-major mover exactly.
 */

import { forceMoveTag } from './force-move-tag.js';
import { headCommit } from './git.js';

export async function advanceV0(opts: { cwd: string }): Promise<number> {
  const target = await headCommit({ cwd: opts.cwd });
  process.stdout.write(`Moving v0 -> ${target}\n`);
  await forceMoveTag('v0', target, { cwd: opts.cwd });
  return 0;
}
