import type { Package } from './config.js';

export function assertNoCycles(packages: readonly Package[]): void {
  const byName = new Map<string, Package>();
  for (const p of packages) {byName.set(p.name, p);}

  type Color = 'white' | 'gray' | 'black';
  const color = new Map<string, Color>();
  for (const p of packages) {color.set(p.name, 'white');}

  const visit = (name: string, path: string[]): void => {
    const c = color.get(name);
    if (c === 'black') {return;}
    if (c === 'gray') {
      const cycle = [...path.slice(path.indexOf(name)), name].join(' → ');
      throw new Error(`putitoutthere.toml: depends_on cycle: ${cycle}`);
    }
    color.set(name, 'gray');
    const node = byName.get(name);
    // `byName.get` is only undefined here when `visit` was entered with
    // a name we iterated over packages for — that list IS the keys of
    // byName, so this branch is unreachable under normal use. Defensive.
    /* v8 ignore start -- byName always contains every visited name; unreachable */
    if (!node) {return;}
    /* v8 ignore stop */
    // `depends_on` is `string[]` post-parse (Zod default `[]`), so the
    // traversal never needs a `?? []` fallback.
    for (const dep of node.depends_on) {
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
