import type { Package } from './config.js';
import { mustGet } from './must-get.js';
import { packagesByName } from './packages-by-name.js';

/**
 * Toposort over depends_on so upstream packages publish before
 * downstream ones that depend on them. Cycle detection already
 * happened in cascade; we can assume acyclic.
 */
export function publishOrder(packages: readonly Package[], selected: readonly string[]): string[] {
  const inSet = new Set(selected);
  const byName = packagesByName(packages);
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) {return;}
    visited.add(name);
    mustGet(byName, name).depends_on?.forEach((d) => {
      if (inSet.has(d)) {visit(d);}
    });
    order.push(name);
  };
  for (const n of selected) {visit(n);}
  return order;
}
