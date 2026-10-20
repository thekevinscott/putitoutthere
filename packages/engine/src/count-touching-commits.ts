import { computeCascade } from './cascade.js';
import type { Package } from './config.js';

export function countTouchingCommits(
  name: string,
  packages: readonly Package[],
  fileSets: readonly (readonly string[])[],
): number {
  return fileSets.filter((files) => {
    const changed = new Set(files);
    const byPackage = new Map(packages.map((p) => [p.name, changed]));
    return computeCascade(packages, byPackage).some((p) => p.name === name);
  }).length;
}
