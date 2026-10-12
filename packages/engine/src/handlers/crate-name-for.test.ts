import { describe, expect, it } from 'vitest';

import { crateNameFor, cratesRegistry } from './crate-name-for.js';

describe('crateNameFor', () => {
  it('prefers the crate override', () => {
    expect(crateNameFor({ name: 'pkg', crate: 'pkg-rs' })).toBe('pkg-rs');
  });

  it('falls back to the package name', () => {
    expect(crateNameFor({ name: 'pkg' })).toBe('pkg');
  });

  it('targets crates.io', () => {
    expect(cratesRegistry()).toBe('https://crates.io');
  });
});
