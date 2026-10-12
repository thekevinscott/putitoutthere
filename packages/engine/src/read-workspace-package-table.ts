import { readFile } from 'node:fs/promises';
import { dirname, join, parse as parsePath } from 'node:path';

import { parse as parseToml } from 'smol-toml';

/**
 * Find the nearest parent `Cargo.toml` whose `[workspace]` table makes
 * it a workspace root and return its `[workspace.package]` table (if
 * any). Walks up from `crateDir` to the filesystem root. Returns
 * `undefined` when no workspace root is found or when the workspace
 * defines no shared `[workspace.package]` metadata.
 */
export async function readWorkspacePackageTable(
  crateDir: string,
): Promise<Record<string, unknown> | undefined> {
  const rootMarker = parsePath(crateDir).root;
  let dir = dirname(crateDir);
  while (dir && dir !== rootMarker) {
    const manifest = join(dir, 'Cargo.toml');
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = parseToml(await readFile(manifest, 'utf8'));
    } catch {
      // Missing or malformed Cargo.toml at this level — skip it and keep
      // walking up. (Cargo surfaces a real parse error itself; we just
      // don't crash the workspace lookup on an unreadable ancestor.)
      parsed = undefined;
    }
    if (parsed !== undefined && parsed.workspace !== undefined) {
      const ws = parsed.workspace as Record<string, unknown>;
      const wsPkg = ws.package;
      if (wsPkg !== undefined && typeof wsPkg === 'object') {
        return wsPkg as Record<string, unknown>;
      }
      // Workspace root found, but no shared metadata — stop walking.
      return undefined;
    }
    // Advance one directory toward the filesystem root. The fixpoint
    // guard terminates the walk for relative crate paths, where
    // dirname() settles on '.' rather than reaching rootMarker.
    const parent = dirname(dir);
    if (parent === dir) {break;}
    dir = parent;
  }
  return undefined;
}
