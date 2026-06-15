/**
 * Pick the commit a backfilled tag should point at.
 *
 * piot reads "changed since last release" from a tag's commit, so the
 * commit matters: tagging an old, already-published version at HEAD would
 * hide every change made since it actually shipped. Prefer a sibling
 * package already tagged at the same version — that tag marks the real
 * release commit (the canonical incident: npm/py tagged `v0.0.1` at the
 * merge the crate also published from). Fall back to HEAD only when no
 * sibling tag exists, matching the publish-path auto-heal, which tags the
 * run's HEAD.
 *
 * Issue #410, #403 slice 3.
 */

import type { Package } from './config.js';
import { headCommit, tagCommit, tagList } from './git.js';
import { formatTag } from './tag-template.js';

export function resolveTagCommit(
  version: string,
  siblings: readonly Package[],
  opts: { cwd: string },
): { commit: string; source: 'sibling' | 'head' } {
  for (const sib of siblings) {
    const sibTag = formatTag(sib.tag_format, { name: sib.name, version });
    if (tagList(sibTag, { cwd: opts.cwd }).length > 0) {
      return { commit: tagCommit(sibTag, { cwd: opts.cwd }), source: 'sibling' };
    }
  }
  return { commit: headCommit({ cwd: opts.cwd }), source: 'head' };
}
