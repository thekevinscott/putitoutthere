import { dirname, join, resolve } from 'node:path';

import { nonEmptyString } from './non-empty-string.js';
import { readToml } from './read-toml.js';

export async function workspaceVersionDeclared(cargoTomlPath: string, cwd: string): Promise<boolean> {
  // Walk parents until we find a Cargo.toml carrying a [workspace]
  // table; bound the walk at `cwd` so we never escape the repo.
  const cwdAbs = resolve(cwd);
  let cur = dirname(resolve(cargoTomlPath));
  // Step out of the package's own directory first — the package's own
  // Cargo.toml never declares its own workspace root.
  cur = dirname(cur);
  while (true) {
    const candidate = join(cur, 'Cargo.toml');
    const parsed = await readToml(candidate);
    if (parsed !== null) {
      const workspace = (parsed.workspace ?? null) as Record<string, unknown> | null;
      if (workspace !== null) {
        const wsPkg = (workspace.package ?? {}) as Record<string, unknown>;
        return nonEmptyString(wsPkg.version);
      }
    }
    if (cur === cwdAbs || cur === dirname(cur)) {return false;}
    cur = dirname(cur);
  }
}
