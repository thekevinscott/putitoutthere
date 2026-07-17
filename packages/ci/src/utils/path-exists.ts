// Deliberate duplicate of packages/engine/src/utils/path-exists.ts (#469) — the ci package is private and the engine does not export internals.
import { stat } from 'node:fs/promises';

/** Async replacement for `existsSync` (node:fs/promises has no exists). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
