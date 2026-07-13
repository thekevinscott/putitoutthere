import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';

// The upward walk's only collaborator is `node:fs`; mock it so this isolates
// the walk/parse/skip logic from disk. The reader is keyed on the Cargo.toml
// path's *directory* (separator-normalized, so the mock behaves identically on
// POSIX and Windows), returning contents or throwing per ancestor. The real
// filesystem walk is covered at the integration + e2e tiers.
vi.mock('node:fs');

const readFileMock = vi.mocked(readFileSync);

const WORKSPACE_TOML = ['[workspace]', 'members = ["pkg"]', ''].join('\n');
const MEMBER_TOML = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');

/**
 * Drive the mocked reader from a map of directory suffix → Cargo.toml contents.
 * A `null` value means that directory's Cargo.toml is malformed TOML; any
 * directory not present throws ENOENT (the "no Cargo.toml here" skip). Paths are
 * matched separator-agnostically so the same expectations hold cross-platform.
 */
function cargoTree(byDirSuffix: Record<string, string>): void {
  readFileMock.mockImplementation(((file: string): string => {
    const norm = file.replace(/\\/g, '/');
    for (const [suffix, contents] of Object.entries(byDirSuffix)) {
      if (norm.endsWith(`${suffix}/Cargo.toml`)) {
        return contents;
      }
    }
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  }) as never);
}

beforeEach(() => {
  readFileMock.mockReset();
});

describe('findWorkspaceRoot (#428)', () => {
  it('returns the ancestor whose Cargo.toml declares [workspace]', () => {
    // `/ws` declares [workspace]; the member `/ws/pkg` does not, so the walk
    // climbs one level and stops at the root.
    cargoTree({ '/ws': WORKSPACE_TOML, '/ws/pkg': MEMBER_TOML });
    const root = findWorkspaceRoot('/ws/pkg');
    // Return value derives from the input via dirname (which preserves the
    // forward slashes we passed); assert separator-agnostically regardless.
    expect(root?.replace(/\\/g, '/')).toBe('/ws');
  });

  it('returns null when no ancestor declares [workspace]', () => {
    // No Cargo.toml anywhere (every read ENOENT-skips), and nothing up to the
    // filesystem root declares a workspace — the walk bottoms out.
    cargoTree({});
    expect(findWorkspaceRoot('/lonely/pkg')).toBeNull();
  });

  it('skips a malformed ancestor Cargo.toml and keeps walking', () => {
    // `/ws/mid`'s Cargo.toml fails to parse (skipped); the walk continues up to
    // `/ws`, which declares [workspace].
    cargoTree({ '/ws': WORKSPACE_TOML, '/ws/mid': '[unclosed\n' });
    const root = findWorkspaceRoot('/ws/mid');
    expect(root?.replace(/\\/g, '/')).toBe('/ws');
  });

  it('propagates a non-ENOENT read error (Cargo.toml is a directory)', () => {
    // Reading a directory throws EISDIR, not ENOENT — which the walk rethrows.
    readFileMock.mockImplementation(() => {
      throw Object.assign(new Error('EISDIR: illegal operation on a directory'), {
        code: 'EISDIR',
      });
    });
    expect(() => findWorkspaceRoot('/ws')).toThrow();
  });
});
