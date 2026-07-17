import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

/**
 * Walk up from `startDir` for the Cargo.toml that declares a `[workspace]`
 * table — the root that a `version.workspace = true` member inherits its
 * version from. Returns that directory, or `null` if none exists between
 * `startDir` and the filesystem root. #428.
 *
 * Sync `readFileSync` with an ENOENT skip (not an `existsSync` precheck)
 * to avoid the TOCTOU shape CodeQL flags, matching the rest of the
 * version-write path. A malformed ancestor Cargo.toml is not treated as
 * the workspace root; the walk continues past it.
 */
export async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    let source = '';
    try {
      source = await readFile(join(dir, 'Cargo.toml'), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
    if (source) {
      let parsed: unknown;
      try {
        parsed = parseToml(source);
      } catch {
        parsed = undefined;
      }
      if (parsed && typeof parsed === 'object' && 'workspace' in parsed) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
