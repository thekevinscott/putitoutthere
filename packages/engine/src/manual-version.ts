import type { Package } from './config.js';
import { lastTag } from './git.js';
import type { ReleasePackagesEntry } from './release-packages.js';
import { bump as bumpVersion, firstVersion, formatSemver } from './version.js';

export async function manualVersion(
  pkg: Package,
  entry: ReleasePackagesEntry,
  cwd: string,
): Promise<string> {
  // Explicit semver is used as-is. It is intentionally NOT compared
  // against the last tag: re-releasing the same version is valid when
  // the prior publish failed before reaching the registry, and the
  // publish-phase `isPublished` check is the right place to refuse a
  // genuine collision.
  if (entry.version !== undefined) {return entry.version;}

  // A bump keyword bumps the last tag, or first_version when the named
  // package has never been released. `lastTag` hands back the parsed
  // version, so there's nothing left to re-parse.
  const last = await lastTag(pkg.name, pkg.tag_format, { cwd });
  if (last === null) {return firstVersion(pkg);}
  return bumpVersion(formatSemver(last.version), entry.bump!);
}
