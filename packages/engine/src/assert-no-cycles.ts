import type { Package } from './config.js';

export function assertNoCycles(packages: readonly Package[]): void {
  const byName = new Map<string, Package>();
  for (const p of packages) {byName.set(p.name, p);}

  const active = new Set<string>();
  const done = new Set<string>();

  const visit = (node: Package, path: string[]): void => {
    active.add(node.name);
    for (const dep of node.depends_on) {
      const next = byName.get(dep);
      if (!next) {
        throw new Error(
          `putitoutthere.toml: package "${node.name}" has unknown depends_on: "${dep}"`,
        );
      }
      if (active.has(dep)) {
        const cycle = [...path.slice(path.indexOf(dep)), dep].join(' → ');
        throw new Error(`putitoutthere.toml: depends_on cycle: ${cycle}`);
      }
      if (!done.has(dep)) {visit(next, [...path, dep]);}
    }
    active.delete(node.name);
    done.add(node.name);
  };

  for (const p of packages) {
    visit(p, [p.name]);
  }
}
