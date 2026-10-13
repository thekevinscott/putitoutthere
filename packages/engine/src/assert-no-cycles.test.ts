import { describe, expect, it } from 'vitest';

import { assertNoCycles } from './assert-no-cycles.js';
import type { Package } from './config.js';

function pkg(name: string, depends_on: string[] = []): Package {
  return { name, kind: 'crates', path: name, globs: [] as string[], depends_on, first_version: '0.1.0' } as Package;
}

describe('assertNoCycles', () => {
  it('accepts an acyclic graph', () => {
    expect(() => assertNoCycles([pkg('a'), pkg('b', ['a']), pkg('c', ['a', 'b'])])).not.toThrow();
  });

  it('accepts disconnected components', () => {
    expect(() =>
      assertNoCycles([pkg('a'), pkg('b'), pkg('c', ['a']), pkg('d', ['b'])]),
    ).not.toThrow();
  });

  it('accepts a diamond, revisiting a finished node without flagging it', () => {
    expect(() =>
      assertNoCycles([pkg('d', ['b', 'c']), pkg('b', ['a']), pkg('c', ['a']), pkg('a')]),
    ).not.toThrow();
  });

  it('visits each package once, so a deep stack of diamonds stays linear', () => {
    const layers = Array.from({ length: 40 }, (_, i) =>
      ['a', 'b'].map((s) => pkg(`n${i}${s}`, i === 0 ? [] : [`n${i - 1}a`, `n${i - 1}b`])),
    );
    expect(() => assertNoCycles(layers.flat().reverse())).not.toThrow();
  });

  it('accepts an empty package list', () => {
    expect(() => assertNoCycles([])).not.toThrow();
  });

  it('names a self-loop', () => {
    expect(() => assertNoCycles([pkg('a', ['a'])])).toThrow(
      new Error('putitoutthere.toml: depends_on cycle: a → a'),
    );
  });

  it('names a two-node cycle', () => {
    expect(() => assertNoCycles([pkg('a', ['b']), pkg('b', ['a'])])).toThrow(
      new Error('putitoutthere.toml: depends_on cycle: a → b → a'),
    );
  });

  it('names only the cycle, not the path that led into it', () => {
    expect(() =>
      assertNoCycles([pkg('x', ['a']), pkg('a', ['b']), pkg('b', ['c']), pkg('c', ['a'])]),
    ).toThrow(new Error('putitoutthere.toml: depends_on cycle: a → b → c → a'));
  });

  it('names the package and the unknown dependency', () => {
    expect(() => assertNoCycles([pkg('a'), pkg('b', ['a', 'ghost'])])).toThrow(
      new Error('putitoutthere.toml: package "b" has unknown depends_on: "ghost"'),
    );
  });
});
