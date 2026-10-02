/**
 * `putitoutthere advance-v0` — force-move the floating `v0` tag to HEAD
 * (#446, epic #442). `v0` tracks main HEAD, not the latest release, so every
 * push to main advances it to the fresh bundle commit the workflow's Fold
 * step (`fold-bundle`) synthesizes first.
 */

import { forceMoveTag } from './force-move-tag.js';
import { headCommit } from './git.js';

export async function advanceV0(opts: { cwd: string }): Promise<number> {
  const target = await headCommit({ cwd: opts.cwd });
  process.stdout.write(`Moving v0 -> ${target}\n`);
  await forceMoveTag('v0', target, { cwd: opts.cwd });
  return 0;
}
