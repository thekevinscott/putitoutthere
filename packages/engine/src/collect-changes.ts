import type { Package } from './config.js';
import { diffNames, lastTag } from './git.js';

export async function collectChanges(
  packages: readonly Package[],
  cwd: string,
): Promise<{
  changesByPackage: ReadonlyMap<string, ReadonlySet<string>>;
  firstRelease: ReadonlySet<string>;
}> {
  const changesByPackage = new Map<string, ReadonlySet<string>>();
  const firstRelease = new Set<string>();
  // Packages in a polyglot repo typically tag together, so many of them
  // point at the same `last_tag-v*` SHA. Memoize `git diff --name-only
  // <tag>..HEAD` by tag so we spawn one `git diff` per unique tag
  // instead of one per package (#140).
  const diffCache = new Map<string, ReadonlySet<string>>();
  for (const p of packages) {
    const last = await lastTag(p.name, p.tag_format, { cwd });
    if (last === null) {
      firstRelease.add(p.name);
      continue;
    }
    const tag = last.tag;
    let diff = diffCache.get(tag);
    if (diff === undefined) {
      diff = new Set(await diffNames(tag, 'HEAD', { cwd }));
      diffCache.set(tag, diff);
    }
    changesByPackage.set(p.name, diff);
  }
  return { changesByPackage, firstRelease };
}
