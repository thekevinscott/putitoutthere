import { describe, expect, it } from 'vitest';

import { resolveInherited } from './resolve-inherited.js';

describe('resolveInherited (#328)', () => {
  const ws = { license: 'MIT' };

  it('returns the workspace value for `<field>.workspace = true`', () => {
    expect(resolveInherited({ workspace: true }, ws, 'license')).toBe('MIT');
  });

  it('yields undefined when there is no workspace table to inherit from', () => {
    expect(resolveInherited({ workspace: true }, undefined, 'license')).toBeUndefined();
  });

  it('passes a literal, null, or non-inheriting table through unchanged', () => {
    const table = { workspace: false };
    expect(resolveInherited('Apache-2.0', ws, 'license')).toBe('Apache-2.0');
    expect(resolveInherited(null, ws, 'license')).toBeNull();
    expect(resolveInherited(table, ws, 'license')).toBe(table);
  });
});
