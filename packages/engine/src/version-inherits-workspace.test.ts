import { describe, expect, it } from 'vitest';

import { versionInheritsWorkspace } from './version-inherits-workspace.js';

describe('versionInheritsWorkspace', () => {
  it('is true for `version.workspace = true`', () => {
    expect(versionInheritsWorkspace({ workspace: true })).toBe(true);
  });

  it('is false for literals, null, and tables without `workspace = true`', () => {
    expect(versionInheritsWorkspace('1.0.0')).toBe(false);
    expect(versionInheritsWorkspace(null)).toBe(false);
    expect(versionInheritsWorkspace(undefined)).toBe(false);
    expect(versionInheritsWorkspace({ workspace: false })).toBe(false);
    expect(versionInheritsWorkspace({ workspace: 'true' })).toBe(false);
  });
});
