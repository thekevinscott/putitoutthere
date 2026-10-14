import type { Package } from './config.js';
import { manualVersion } from './manual-version.js';
import type { MatrixRow } from './plan.js';
import type { ReleasePackagesEntry } from './release-packages.js';
import { rowsForPackage } from './rows-for-package.js';

/**
 * Manual-release planner. Emits a matrix for exactly the packages named
 * in the `release_packages` spec — no change detection, no cascade.
 * Each named package is versioned per its entry: an explicit semver is
 * used verbatim, a bump keyword bumps the last tag (or first_version
 * when the package has no tag yet).
 */
export async function planManual(
  packages: readonly Package[],
  manual: ReadonlyMap<string, ReleasePackagesEntry>,
  cwd: string,
): Promise<MatrixRow[]> {
  const known = new Set(packages.map((p) => p.name));
  for (const name of manual.keys()) {
    if (!known.has(name)) {
      throw new Error(
        `release-packages: "${name}" is not declared in putitoutthere.toml`,
      );
    }
  }
  // Iterate config order so the matrix shape matches the change-
  // detected path for the same package set.
  const rows: MatrixRow[] = [];
  for (const p of packages) {
    const entry = manual.get(p.name);
    if (entry === undefined) {continue;}
    rows.push(...(await rowsForPackage(p, await manualVersion(p, entry, cwd), cwd)));
  }
  return rows;
}
