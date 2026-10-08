import type { ScopeDeps } from './scope-types.js';

export async function closure(seeds: readonly string[], deps: ScopeDeps): Promise<ReadonlySet<string>> {
  const seen = new Set(seeds);
  const queue = [...seen];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const content = await deps.readFile(path);
    if (content === undefined) {
      continue;
    }
    for (const ref of deps.extractRefs(path, content)) {
      if (seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      queue.push(ref);
    }
  }
  return seen;
}
