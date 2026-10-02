/**
 * Pick the commit a backfilled tag should point at (#410, #403). piot reads
 * "changed since last release" from a tag's commit, so tagging an
 * already-published version at HEAD would hide every change made since it
 * shipped. Prefer a sibling already tagged at the same version; else HEAD.
 */

import type { Package } from './config.js';
import { headCommit, tagCommit, tagList } from './git.js';
import { formatTag } from './tag-template.js';

export async function resolveTagCommit(
  version: string,
  siblings: readonly Package[],
  opts: { cwd: string },
): Promise<{ commit: string; source: 'sibling' | 'head' }> {
  for (const sib of siblings) {
    const sibTag = formatTag(sib.tag_format, { name: sib.name, version });
    if ((await tagList(sibTag, { cwd: opts.cwd })).length > 0) {
      return { commit: await tagCommit(sibTag, { cwd: opts.cwd }), source: 'sibling' };
    }
  }
  return { commit: await headCommit({ cwd: opts.cwd }), source: 'head' };
}
