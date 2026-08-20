/**
 * Unit tests for `resolveDepDirs` (#621).
 *
 * Two indirections decide whether a crate is found at all: an entry may
 * defer to `[workspace.dependencies]` (putting both the path and the
 * requirement in the workspace root, a different file), and `path` is
 * relative to the manifest that DECLARED it -- the root for an inherited
 * entry, not the member. Getting either wrong silently drops a crate from
 * the version rewrite, which is the original bug wearing a new hat.
 *
 * Fixtures are plain objects rather than parsed TOML, and directories are
 * asserted by suffix rather than by equality: the unit suite also runs on
 * windows-latest, where resolving "/repo/packages/host" yields a
 * drive-lettered, backslash-separated path. Comparing the tail keeps the
 * assertion honest on both without importing a path collaborator.
 */

import { describe, expect, it } from 'vitest';

import { resolveDepDirs } from './resolve-dep-dirs.js';

const ROOT = '/repo';
const MEMBER = '/repo/packages/host';

/** Compare directories independent of separator and drive-letter prefix. */
const endsAt = (actual: string | undefined, expected: string): boolean =>
  (actual ?? '').replace(/\\/g, '/').endsWith(expected);

/** A parsed workspace-root manifest carrying `[workspace.dependencies]`. */
const wsWith = (deps: Record<string, unknown>): unknown => ({
  workspace: { members: [], dependencies: deps },
});

describe('resolveDepDirs', () => {
  it('resolves a path relative to the declaring manifest directory', () => {
    const parsed = { dependencies: { core: { path: '../core', version: '0.2' } } };
    const [entry] = resolveDepDirs(parsed, MEMBER, null, null);
    expect(entry?.key).toBe('core');
    expect(endsAt(entry?.dir, '/repo/packages/core')).toBe(true);
    expect(entry?.hasVersionReq).toBe(true);
    expect(entry?.inheritsFromWorkspace).toBe(false);
  });

  it('omits registry dependencies, which have no directory', () => {
    const parsed = { dependencies: { pyo3: { version: '0.22' }, serde: '1' } };
    expect(resolveDepDirs(parsed, MEMBER, null, null)).toEqual([]);
  });

  it('resolves an inherited entry against the WORKSPACE ROOT, not the member', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    const ws = wsWith({ core: { path: 'packages/core', version: '0.2' } });
    const [entry] = resolveDepDirs(parsed, MEMBER, ws, ROOT);
    // `packages/core` is relative to the ROOT, so resolving it against the
    // member would land at <root>/packages/host/packages/core and find nothing.
    expect(endsAt(entry?.dir, '/repo/packages/core')).toBe(true);
    expect(endsAt(entry?.dir, '/host/packages/core')).toBe(false);
    expect(entry?.hasVersionReq).toBe(true);
    expect(entry?.inheritsFromWorkspace).toBe(true);
  });

  it('reports an inherited entry with no requirement in the workspace table', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    const ws = wsWith({ core: { path: 'packages/core' } });
    expect(resolveDepDirs(parsed, MEMBER, ws, ROOT)?.[0]?.hasVersionReq).toBe(false);
  });

  it('skips an inherited entry the workspace table does not declare', () => {
    const parsed = { dependencies: { missing: { workspace: true } } };
    expect(resolveDepDirs(parsed, MEMBER, wsWith({ other: { path: 'o' } }), ROOT)).toEqual([]);
  });

  it('skips an inherited entry when there is no workspace at all', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    expect(resolveDepDirs(parsed, MEMBER, null, null)).toEqual([]);
  });

  it('skips inherited entries when a workspace table is supplied without a root', () => {
    // `[workspace.dependencies]` paths are written relative to the root
    // manifest. With no root there is nothing to resolve them against, so
    // consulting the table anyway would invent a directory from the wrong base.
    const parsed = { dependencies: { core: { workspace: true } } };
    const ws = wsWith({ core: { path: 'packages/core', version: '0.2' } });
    expect(resolveDepDirs(parsed, MEMBER, ws, null)).toEqual([]);
  });

  it('skips a workspace dependency that resolves from the registry', () => {
    const parsed = { dependencies: { serde: { workspace: true } } };
    // No `path` in the workspace table -- it is a registry dep, not in-repo.
    expect(resolveDepDirs(parsed, MEMBER, wsWith({ serde: { version: '1' } }), ROOT)).toEqual([]);
  });

  it('ignores a malformed workspace dependencies table', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    expect(resolveDepDirs(parsed, MEMBER, { workspace: 'nonsense' }, ROOT)).toEqual([]);
    expect(resolveDepDirs(parsed, MEMBER, { workspace: { dependencies: 'x' } }, ROOT)).toEqual([]);
    expect(resolveDepDirs(parsed, MEMBER, 'not a manifest', ROOT)).toEqual([]);
    expect(resolveDepDirs(parsed, MEMBER, null, ROOT)).toEqual([]);
  });

  it('skips a non-object entry in the workspace dependencies table', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    expect(resolveDepDirs(parsed, MEMBER, wsWith({ core: 'ignored' }), ROOT)).toEqual([]);
    // `typeof null === "object"`, so null needs its own guard or it reaches
    // a property read and throws.
    expect(resolveDepDirs(parsed, MEMBER, wsWith({ core: null }), ROOT)).toEqual([]);
  });

  it('ignores a null workspace table or dependencies table', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    expect(resolveDepDirs(parsed, MEMBER, { workspace: null }, ROOT)).toEqual([]);
    expect(resolveDepDirs(parsed, MEMBER, { workspace: { dependencies: null } }, ROOT)).toEqual([]);
  });

  it('does not resolve a member-declared registry dep from the workspace table', () => {
    // `serde` is declared directly on the member with a version and no path,
    // so it is a registry dependency. A same-named `[workspace.dependencies]`
    // entry belongs to members that write `serde.workspace = true` -- reading
    // it here would invent a path dependency the member never declared.
    const parsed = { dependencies: { serde: { version: '1' } } };
    const ws = wsWith({ serde: { path: 'vendor/serde', version: '1' } });
    expect(resolveDepDirs(parsed, MEMBER, ws, ROOT)).toEqual([]);
  });

  it('skips a workspace entry whose path is not a string', () => {
    const parsed = { dependencies: { core: { workspace: true } } };
    expect(resolveDepDirs(parsed, MEMBER, wsWith({ core: { path: 42 } }), ROOT)).toEqual([]);
  });

  it('keeps an absolute path as written', () => {
    const parsed = { dependencies: { core: { path: '/elsewhere/core' } } };
    // Already absolute: joining it onto the manifest dir would be wrong.
    expect(resolveDepDirs(parsed, MEMBER, null, null)?.[0]?.dir).toBe('/elsewhere/core');
  });

  it('resolves path dependencies across every dependency table', () => {
    const parsed = {
      dependencies: { a: { path: '../a' } },
      'dev-dependencies': { b: { path: '../b' } },
      target: { 'cfg(unix)': { dependencies: { c: { path: '../c' } } } },
    };
    const dirs = resolveDepDirs(parsed, MEMBER, null, null).map((d) => d.dir);
    expect(dirs).toHaveLength(3);
    for (const name of ['a', 'b', 'c']) {
      expect(dirs.some((d) => endsAt(d, `/repo/packages/${name}`))).toBe(true);
    }
  });
});
