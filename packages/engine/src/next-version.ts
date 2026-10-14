import type { Package } from './config.js';
import { lastTag } from './git.js';
import type { Bump } from './types.js';
import { bump as bumpVersion, firstVersion, formatSemver } from './version.js';

export async function nextVersion(
  pkg: Package,
  trailerBump: Bump | 'skip' | undefined,
  cwd: string,
  trailerPackages: ReadonlySet<string>,
): Promise<string> {
  const last = await lastTag(pkg.name, pkg.tag_format, { cwd });
  if (last === null) {
    return firstVersion(pkg);
  }
  const lastVersion = formatSemver(last.version);

  // Trailer bump applies to every cascaded package, OR specifically to
  // packages listed in [trailer.packages]. If the trailer scoped the
  // list, only listed packages get the trailer's bump; unlisted
  // cascaded packages still go at default patch.
  const wantsBump =
    trailerBump !== undefined &&
    trailerBump !== 'skip' &&
    (trailerPackages.size === 0 || trailerPackages.has(pkg.name));

  const bumpType: Bump = wantsBump ? trailerBump : 'patch';
  return bumpVersion(lastVersion, bumpType);
}
