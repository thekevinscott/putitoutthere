import type { GitOptions } from './git-types.js';
import { greater } from './greater.js';
import { tagList } from './tag-list.js';
import { parseTagVersion, tagGlob } from './tag-template.js';
import { parseSemver, type Semver } from './version.js';

/**
 * Find the highest-semver tag for a given package, matching its `tag_format`
 * template (default `{name}-v{version}`). Candidates that match the glob but
 * not strict semver are skipped silently — operator noise, not tool output.
 * Returns the winning tag with its already-parsed `version`, or null.
 */
export async function lastTag(
  packageName: string,
  tagFormat: string,
  opts: GitOptions = {},
): Promise<{ tag: string; version: Semver } | null> {
  const candidates = await tagList(tagGlob(tagFormat, packageName), opts);

  let best: { tag: string; version: Semver } | null = null;
  for (const tag of candidates) {
    const versionPart = parseTagVersion(tagFormat, packageName, tag);
    // `parseTagVersion` returns null for anything not strict semver, so
    // the surviving candidates parse cleanly — no defensive re-guard.
    if (versionPart === null) {continue;}
    const parsed = parseSemver(versionPart);
    if (!best || greater(parsed, best.version)) {
      best = { tag, version: parsed };
    }
  }
  return best;
}
