import { describe, expect, it } from 'vitest';

import type { Package } from './config.js';
import { publishOrder } from './publish-order.js';

function pkg(name: string, depends_on: string[] = []): Package {
  return {
    name,
    kind: 'crates',
    path: name,
    globs: ['**'],
    depends_on,
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

describe('publishOrder', () => {
  it('keeps selection order when nothing depends on anything', () => {
    expect(publishOrder([pkg('a'), pkg('b'), pkg('c')], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('puts every dependency before its dependents, transitively', () => {
    const packages = [pkg('app', ['lib']), pkg('lib', ['core']), pkg('core')];
    expect(publishOrder(packages, ['app', 'lib', 'core'])).toEqual(['core', 'lib', 'app']);
  });

  it('visits a shared dependency once', () => {
    const packages = [pkg('py', ['core']), pkg('js', ['core']), pkg('core')];
    expect(publishOrder(packages, ['py', 'js', 'core'])).toEqual(['core', 'py', 'js']);
  });

  it('ignores dependencies that are not selected', () => {
    const packages = [pkg('a'), pkg('b', ['a'])];
    expect(publishOrder(packages, ['b'])).toEqual(['b']);
  });

  it('leaves configured but unselected packages out', () => {
    expect(publishOrder([pkg('a'), pkg('b')], ['a'])).toEqual(['a']);
  });

  it('treats a missing depends_on as no dependencies', () => {
    const bare = { ...pkg('a'), depends_on: undefined } as unknown as Package;
    expect(publishOrder([bare], ['a'])).toEqual(['a']);
  });
});
