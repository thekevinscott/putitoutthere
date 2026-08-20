/**
 * Unit tests for `resolveDepDirs` (#621).
 *
 * Two indirections decide whether a crate is found at all: an entry may
 * defer to `[workspace.dependencies]` (putting both the path and the
 * requirement in the workspace root, a different file), and `path` is
 * relative to the manifest that DECLARED it -- the root for an inherited
 * entry, not the member. Getting either wrong silently drops a crate from
 * the version rewrite, which is the original bug wearing a new hat.
 */

import { describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';

import { resolveDepDirs } from './resolve-dep-dirs.js';

const ROOT = '/repo';
const MEMBER = '/repo/packages/host';

const wsWith = (deps: string): unknown =>
  parseToml(`[workspace]\nmembers = []\n[workspace.dependencies]\n${deps}\n`);

describe('resolveDepDirs', () => {
  it('resolves a path relative to the declaring manifest directory', () => {
    const parsed = parseToml('[dependencies]\ncore = { path = "../core", version = "0.2" }\n');
    expect(resolveDepDirs(parsed, MEMBER, null, null)).toEqual([
      { key: 'core', dir: '/repo/packages/core', hasVersionReq: true, inheritsFromWorkspace: false },
    ]);
  });

  it('omits registry dependencies, which have no directory', () => {
    const parsed = parseToml('[dependencies]\npyo3 = { version = "0.22" }\nserde = "1"\n');
    expect(resolveDepDirs(parsed, MEMBER, null, null)).toEqual([]);
  });

  it('resolves an inherited entry against the WORKSPACE ROOT, not the member', () => {
    const parsed = parseToml('[dependencies]\ncore.workspace = true\n');
    const ws = wsWith('core = { path = "packages/core", version = "0.2" }');
    // `packages/core` is relative to /repo, so resolving it against the
    // member would land at /repo/packages/host/packages/core and find nothing.
    expect(resolveDepDirs(parsed, MEMBER, ws, ROOT)).toEqual([
      { key: 'core', dir: '/repo/packages/core', hasVersionReq: true, inheritsFromWorkspace: true },
    ]);
  });

  it('reports an inherited entry with no requirement in the workspace table', () => {
    const parsed = parseToml('[dependencies]\ncore.workspace = true\n');
    const ws = wsWith('core = { path = "packages/core" }');
    expect(resolveDepDirs(parsed, MEMBER, ws, ROOT)?.[0]?.hasVersionReq).toBe(false);
  });

  it('skips an inherited entry the workspace table does not declare', () => {
    const parsed = parseToml('[dependencies]\nmissing.workspace = true\n');
    expect(resolveDepDirs(parsed, MEMBER, wsWith('other = { path = "o" }'), ROOT)).toEqual([]);
  });

  it('skips an inherited entry when there is no workspace at all', () => {
    const parsed = parseToml('[dependencies]\ncore.workspace = true\n');
    expect(resolveDepDirs(parsed, MEMBER, null, null)).toEqual([]);
  });

  it('skips a workspace dependency that resolves from the registry', () => {
    const parsed = parseToml('[dependencies]\nserde.workspace = true\n');
    // No `path` in the workspace table -- it is a registry dep, not in-repo.
    expect(resolveDepDirs(parsed, MEMBER, wsWith('serde = { version = "1" }'), ROOT)).toEqual([]);
  });

  it('keeps an absolute path as written', () => {
    const parsed = parseToml('[dependencies]\ncore = { path = "/elsewhere/core" }\n');
    expect(resolveDepDirs(parsed, MEMBER, null, null)?.[0]?.dir).toBe('/elsewhere/core');
  });

  it('resolves path dependencies across every dependency table', () => {
    const parsed = parseToml(
      [
        '[dependencies]',
        'a = { path = "../a" }',
        '[dev-dependencies]',
        'b = { path = "../b" }',
        "[target.'cfg(unix)'.dependencies]",
        'c = { path = "../c" }',
      ].join('\n'),
    );
    expect(resolveDepDirs(parsed, MEMBER, null, null).map((d) => d.dir).sort()).toEqual([
      '/repo/packages/a',
      '/repo/packages/b',
      '/repo/packages/c',
    ]);
  });
});
