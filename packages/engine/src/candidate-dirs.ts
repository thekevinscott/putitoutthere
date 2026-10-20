import { resolve } from 'node:path';

import { expandDirGlob } from './expand-dir-glob.js';

/**
 * Every manifest that could declare a requirement on the released crate: the
 * workspace root (where an inheriting member's requirement actually lives),
 * each of its members, and the other declared packages.
 *
 * Members are expanded with `expandDirGlob`, which mirrors how cargo resolves
 * `[workspace].members` — a literal entry resolves as written, a glob entry
 * matches against the real tree. Scanning members rather than only the
 * declared packages matters because a crate the repo does not publish can
 * still sit between two that it does, and cargo resolves the whole graph.
 */
export async function candidateDirs(
  workspaceRoot: string | null,
  workspaceParsed: unknown,
  siblingDirs: readonly string[] | undefined,
): Promise<Set<string>> {
  const dirs = new Set<string>();
  // An explicit guard rather than a `?? []` default: the caller holds an
  // optional field, and "no sibling packages" and "an empty list of them"
  // are the same thing to this walk.
  if (siblingDirs !== undefined) {
    for (const d of siblingDirs) {dirs.add(resolve(d));}
  }
  if (workspaceRoot === null) {return dirs;}

  dirs.add(resolve(workspaceRoot));
  const members = (workspaceParsed as { workspace?: { members?: unknown } } | null)?.workspace
    ?.members;
  if (!Array.isArray(members)) {return dirs;}
  for (const member of members) {
    if (typeof member !== 'string') {continue;}
    for (const d of await expandDirGlob(workspaceRoot, member)) {dirs.add(resolve(d));}
  }
  return dirs;
}
