import { describe, expect, it } from 'vitest';

import { npmNameFor } from './npm-name-for.js';

describe('npmNameFor', () => {
  it('prefers the npm override', () => {
    expect(npmNameFor({ name: 'pkg', path: '.', npm: '@s/pkg' })).toBe('@s/pkg');
  });

  it('falls back to the package name', () => {
    expect(npmNameFor({ name: 'pkg', path: '.' })).toBe('pkg');
  });
});
