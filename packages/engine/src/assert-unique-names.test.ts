import { describe, expect, it } from 'vitest';

import { assertUniqueNames } from './assert-unique-names.js';
import type { Package } from './config.js';

const pkgs = (...names: string[]): Package[] =>
  names.map((name) => ({ name }) as unknown as Package);

describe('assertUniqueNames', () => {
  it('accepts distinct names', () => {
    expect(() => assertUniqueNames(pkgs('a', 'b', 'c'))).not.toThrow();
  });

  it('accepts an empty list', () => {
    expect(() => assertUniqueNames([])).not.toThrow();
  });

  it('names the first repeated package', () => {
    expect(() => assertUniqueNames(pkgs('a', 'b', 'a', 'b'))).toThrow(
      'putitoutthere.toml: duplicate package name: a',
    );
  });
});
