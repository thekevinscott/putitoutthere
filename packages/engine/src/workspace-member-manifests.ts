import { dirname, join } from 'node:path';

import { expandDirGlob } from './expand-dir-glob.js';

export async function workspaceMemberManifests(
  cargoToml: Record<string, unknown>,
  cargoTomlPath: string,
): Promise<string[]> {
  const workspace = cargoToml.workspace;
  if (typeof workspace !== 'object' || workspace === null) {return [];}
  const members = (workspace as { members?: unknown }).members;
  if (!Array.isArray(members)) {return [];}
  const workspaceDir = dirname(cargoTomlPath);
  const out: string[] = [];
  for (const m of members) {
    if (typeof m === 'string') {
      // `members` entries are globs (`packages/*`); expand them against
      // the filesystem the way cargo does so a member crate's [[bin]] is
      // found even when the workspace declares its members with a pattern.
      for (const memberDir of await expandDirGlob(workspaceDir, m)) {
        out.push(join(memberDir, 'Cargo.toml'));
      }
    }
  }
  return out;
}
