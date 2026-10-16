import { describe, expect, it } from 'vitest';

import { toCargoDepEntry } from './to-cargo-dep-entry.js';

describe('toCargoDepEntry', () => {
  it('reports the path and version requirement of a path dependency', () => {
    expect(toCargoDepEntry('a', { path: '../a', version: '0.2' })).toEqual({
      key: 'a',
      path: '../a',
      hasVersionReq: true,
      inheritsFromWorkspace: false,
    });
  });

  it('marks a path dependency carrying no version requirement', () => {
    const entry = toCargoDepEntry('a', { path: '../a' });
    expect(entry.hasVersionReq).toBe(false);
    expect(entry.path).toBe('../a');
  });

  it('treats the shorthand form as a registry dependency with no path', () => {
    // Never a path dependency, so it must never be rewritten -- but it does
    // carry a requirement, and reporting that keeps callers from re-deriving it.
    expect(toCargoDepEntry('serde', '1')).toEqual({
      key: 'serde',
      hasVersionReq: true,
      inheritsFromWorkspace: false,
    });
  });

  it('flags an entry that defers to [workspace.dependencies]', () => {
    const entry = toCargoDepEntry('a', { workspace: true });
    expect(entry.inheritsFromWorkspace).toBe(true);
    expect(entry.path).toBeUndefined();
    expect(entry.hasVersionReq).toBe(false);
  });

  it('reports a registry dependency with no path', () => {
    const entry = toCargoDepEntry('pyo3', { version: '0.22' });
    expect(entry.path).toBeUndefined();
    expect(entry.hasVersionReq).toBe(true);
  });

  it('ignores a non-string path', () => {
    expect(toCargoDepEntry('a', { path: 42 }).path).toBeUndefined();
  });

  it('treats a null dependency value as carrying nothing', () => {
    expect(toCargoDepEntry('a', null)).toEqual({
      key: 'a',
      hasVersionReq: false,
      inheritsFromWorkspace: false,
    });
  });
});
