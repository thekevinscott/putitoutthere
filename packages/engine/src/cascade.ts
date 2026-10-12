/**
 * Cascade algorithm (#7, plan.md §11.1): direct glob match per package, then
 * transitive `depends_on` closure. Seed detection is strictly per-package —
 * the union of every package's diff would let commits already shipped under
 * one package's prior tag spuriously re-trigger another (#126).
 */

import { assertNoCycles } from './assert-no-cycles.js';
import type { Package } from './config.js';
import { matchesAny } from './glob.js';

/**
 * Per-package changed files keyed by package name. Each value is the
 * set of files that changed between that package's last tag and HEAD.
 * Packages without an entry are skipped in seed detection (e.g.
 * first-release packages the caller force-cascades separately, or
 * untagged packages).
 */
export type ChangedFilesByPackage = ReadonlyMap<string, ReadonlySet<string>>;

export function computeCascade(
  packages: readonly Package[],
  changedFilesByPackage: ChangedFilesByPackage,
): Package[] {
  assertNoCycles(packages);

  const byName = new Map<string, Package>();
  for (const p of packages) {byName.set(p.name, p);}

  // Pass 1: direct glob matches against this package's own diff.
  const cascaded = new Set<string>();
  for (const p of packages) {
    const files = changedFilesByPackage.get(p.name);
    if (!files) {continue;}
    for (const f of files) {
      if (matchesAny(p.globs, f)) {
        cascaded.add(p.name);
        break;
      }
    }
  }

  // Pass 2: transitive via depends_on, iterate to stability.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of packages) {
      if (cascaded.has(p.name)) {continue;}
      // `depends_on` is `string[]` post-parse — the Zod schema defaults it
      // to `[]` — so no `?? []` fallback is representable here.
      if (p.depends_on.some((d) => cascaded.has(d))) {
        cascaded.add(p.name);
        changed = true;
      }
    }
  }

  // Preserve input order.
  return packages.filter((p) => cascaded.has(p.name));
}
