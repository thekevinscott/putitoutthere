import { readCargoManifest } from './read-cargo-manifest.js';
import { resolveDepDirs } from './resolve-dep-dirs.js';

/**
 * Breadth-first walk of path dependencies out of `startDir`. Returns the
 * crates reached, excluding `startDir` — seeding `seen` with it also keeps
 * a dependency cycle back to the start from re-queueing forever.
 */
export async function collectEmbedded(
  startDir: string,
  workspaceParsed: unknown,
  workspaceRoot: string | null,
): Promise<Set<string>> {
  const seen = new Set<string>([startDir]);
  const found = new Set<string>();
  const queue: string[] = [startDir];

  while (queue.length > 0) {
    const dir = queue.shift() as string;
    const manifest = await readCargoManifest(dir);
    if (manifest === null) {continue;}

    for (const dep of resolveDepDirs(manifest.parsed, dir, workspaceParsed, workspaceRoot)) {
      if (seen.has(dep.dir)) {continue;}
      seen.add(dep.dir);
      found.add(dep.dir);
      queue.push(dep.dir);
    }
  }
  return found;
}
