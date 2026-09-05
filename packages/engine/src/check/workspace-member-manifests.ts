import { dirname, join } from 'node:path';

import { expandDirGlob } from '../glob.js';

export async function workspaceMemberManifests(
  parsed: Record<string, unknown>,
  cargoTomlPath: string,
): Promise<string[]> {
  const workspace = parsed.workspace;
  if (typeof workspace !== 'object' || workspace === null) {return [];}
  const members = (workspace as { members?: unknown }).members;
  if (!Array.isArray(members)) {return [];}
  const workspaceDir = dirname(cargoTomlPath);
  const out: string[] = [];
  for (const m of members) {
    if (typeof m === 'string') {
      for (const memberDir of await expandDirGlob(workspaceDir, m)) {
        out.push(join(memberDir, 'Cargo.toml'));
      }
    }
  }
  return out;
}
