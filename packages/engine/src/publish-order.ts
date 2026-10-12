import type { Package } from './config.js';
import { mustGet } from './must-get.js';

/**
 * Toposort over depends_on so upstream packages publish before
 * downstream ones that depend on them. Cycle detection already
 * happened in cascade; we can assume acyclic.
 */
export function publishOrder(packages: readonly Package[], selected: readonly string[]): string[] {
  const inSet = new Set(selected);
  const deps = new Map<string, string[]>();
  for (const p of packages) {
    if (inSet.has(p.name)) {
      deps.set(
        p.name,
        (p.depends_on ?? []).filter((d) => inSet.has(d)),
      );
    }
  }
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) {return;}
    visited.add(name);
    // `deps` is seeded for every selected package above, and recursion only
    // reaches names already filtered into `inSet` (⊆ selected), so the
    // lookup is total — `mustGet` reflects that instead of a dead `?? []`.
    const childDeps = mustGet(deps, name);
    for (const d of childDeps) {visit(d);}
    order.push(name);
  };
  for (const n of selected) {visit(n);}
  return order;
}
