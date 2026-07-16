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
