import { describe, expect, it } from 'vitest';

import { packagesByName } from './packages-by-name.js';
import type { Package } from './config.js';

function pkg(name: string): Package {
  return {
    name,
    kind: 'crates',
    path: name,
    globs: [`${name}/**`],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

describe('packagesByName', () => {
  it('indexes each package under its own name, by reference', () => {
    const a = pkg('a');
    const b = pkg('b');
    const idx = packagesByName([a, b]);
    // size === length pins that every package became its own entry: the
    // `[p.name, p] -> []` mutant collapses all entries to a single
    // `{undefined: undefined}` (size 1), and the `(p) => [...] -> () =>
    // undefined` mutant throws building the map — both fail here.
    expect(idx.size).toBe(2);
    expect(idx.get('a')).toBe(a);
    expect(idx.get('b')).toBe(b);
    expect([...idx.keys()]).toEqual(['a', 'b']);
  });

  it('returns an empty index for an empty package list', () => {
    expect(packagesByName([]).size).toBe(0);
  });
});
