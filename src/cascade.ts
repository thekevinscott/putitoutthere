/**
 * Cascade algorithm. Given a package list and the files changed since
 * the last release, returns the packages that will release.
 *
 * Two passes (plan.md §11.1):
 *   1. Direct match: every package whose `paths` globs intersect
 *      changedFiles is cascaded.
 *   2. Transitive match: repeat until stable — any package whose
 *      `depends_on` list contains an already-cascaded package gets
 *      added.
 *
 * Cycle detection per §11.3: cycles in depends_on are a config error
 * and throw loudly before cascade runs. Dangling depends_on names also
 * throw.
 *
 * Output preserves the input order so downstream matrix emission is
 * deterministic.
 *
 * Issue #7.
 */

import type { Package } from './config.js';
import { matchesAny } from './glob.js';

export function computeCascade(
  packages: readonly Package[],
  changedFiles: readonly string[],
): Package[] {
  assertNoCycles(packages);

  const byName = new Map<string, Package>();
  for (const p of packages) byName.set(p.name, p);

  // Pass 1: direct glob matches.
  const cascaded = new Set<string>();
  for (const p of packages) {
    if (changedFiles.some((f) => matchesAny(p.paths, f))) {
      cascaded.add(p.name);
    }
  }

  // Pass 2: transitive via depends_on, iterate to stability.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of packages) {
      if (cascaded.has(p.name)) continue;
      /* v8 ignore next -- depends_on default is always [] from the Zod schema */
      const deps = p.depends_on ?? [];
      if (deps.some((d) => cascaded.has(d))) {
        cascaded.add(p.name);
        changed = true;
      }
    }
  }

  // Preserve input order.
  return packages.filter((p) => cascaded.has(p.name));
}

/**
 * Reject cycles and dangling depends_on refs. Runs a DFS from each
 * node with a recursion-stack (gray) set to flag back-edges. Dangling
 * refs are caught during traversal when the target is missing from
 * the name map.
 */
export function assertNoCycles(packages: readonly Package[]): void {
  const byName = new Map<string, Package>();
  for (const p of packages) byName.set(p.name, p);

  type Color = 'white' | 'gray' | 'black';
  const color = new Map<string, Color>();
  for (const p of packages) color.set(p.name, 'white');

  const visit = (name: string, path: string[]): void => {
    const c = color.get(name);
    if (c === 'black') return;
    if (c === 'gray') {
      const cycle = [...path.slice(path.indexOf(name)), name].join(' → ');
      throw new Error(`putitoutthere.toml: depends_on cycle: ${cycle}`);
    }
    color.set(name, 'gray');
    const node = byName.get(name);
    // `byName.get` is only undefined here when `visit` was entered with
    // a name we iterated over packages for — that list IS the keys of
    // byName, so this branch is unreachable under normal use. Defensive.
    /* v8 ignore next */
    if (!node) return;
    /* v8 ignore next -- depends_on default is always [] from the Zod schema */
    for (const dep of node.depends_on ?? []) {
      if (!byName.has(dep)) {
        throw new Error(
          `putitoutthere.toml: package "${name}" has unknown depends_on: "${dep}"`,
        );
      }
      visit(dep, [...path, name]);
    }
    color.set(name, 'black');
  };

  for (const p of packages) {
    visit(p.name, []);
  }
}
