import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { toPosixPath } from './utils/to-posix-path.js';

/**
 * Recursive file listing. Wheels and sdists may sit one level deep in
 * a `dist/` subdir depending on how the user's build writes them.
 */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else if (st.isFile() && st.size > 0) {
      // Normalize separators once, here at the listing boundary, so every
      // downstream trailing-name check is a single `/<name>` comparison
      // that holds on Windows and POSIX alike.
      out.push(toPosixPath(full));
    }
  }
  return out;
}
