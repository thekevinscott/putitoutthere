import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findWorkspaceRoot } from './find-workspace-root.js';

// The upward walk's only collaborator is `node:fs`; mock it so this isolates
// the walk/parse/skip logic from disk. The reader is keyed on the Cargo.toml
// path's *directory* (separator-normalized, so the mock behaves identically on
// POSIX and Windows), returning contents or throwing per ancestor. The real
// filesystem walk is covered at the integration + e2e tiers.
vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);

const WORKSPACE_TOML = ['[workspace]', 'members = ["pkg"]', ''].join('\n');
const MEMBER_TOML = ['[package]', 'name = "x"', 'version.workspace = true', ''].join('\n');

/**
 * Drive the mocked reader from a map of directory suffix → Cargo.toml contents.
 * A `null` value means that directory's Cargo.toml is malformed TOML; any
 * directory not present throws ENOENT (the "no Cargo.toml here" skip). Paths are
 * matched separator-agnostically so the same expectations hold cross-platform.
 */
function cargoTree(byDirSuffix: Record<string, string>): void {
  readFileMock.mockImplementation(((file: string): Promise<string> => {
    const norm = file.replace(/\\/g, '/');
    for (const [suffix, contents] of Object.entries(byDirSuffix)) {
      if (norm.endsWith(`${suffix}/Cargo.toml`)) {
        return Promise.resolve(contents);
      }
    }
    return Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));
  }) as never);
}

beforeEach(() => {
  readFileMock.mockReset();
});

describe('findWorkspaceRoot (#428)', () => {
  it('returns the ancestor whose Cargo.toml declares [workspace]', async () => {
    // `/ws` declares [workspace]; the member `/ws/pkg` does not, so the walk
    // climbs one level and stops at the root.
    cargoTree({ '/ws': WORKSPACE_TOML, '/ws/pkg': MEMBER_TOML });
    const root = await findWorkspaceRoot('/ws/pkg');
    // Return value derives from the input via dirname (which preserves the
    // forward slashes we passed); assert separator-agnostically regardless.
    expect(root?.replace(/\\/g, '/')).toBe('/ws');
    // Pin the read target: the Cargo.toml filename and the utf8 text encoding.
    // Dropping either literal reads the wrong path (a directory) or raw bytes.
    expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml'), 'utf8');
  });

  it('returns null when no ancestor declares [workspace]', async () => {
    // No Cargo.toml anywhere (every read ENOENT-skips), and nothing up to the
    // filesystem root declares a workspace — the walk bottoms out.
    cargoTree({});
    expect(await findWorkspaceRoot('/lonely/pkg')).toBeNull();
  });

  it('skips a malformed ancestor Cargo.toml and keeps walking', async () => {
    // `/ws/mid`'s Cargo.toml fails to parse (skipped); the walk continues up to
    // `/ws`, which declares [workspace].
    cargoTree({ '/ws': WORKSPACE_TOML, '/ws/mid': '[unclosed\n' });
    const root = await findWorkspaceRoot('/ws/mid');
    expect(root?.replace(/\\/g, '/')).toBe('/ws');
  });

  it('propagates a non-ENOENT read error (Cargo.toml is a directory)', async () => {
    // Reading a directory throws EISDIR, not ENOENT — which the walk rethrows.
    readFileMock.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('EISDIR: illegal operation on a directory'), {
        code: 'EISDIR',
      })),
    );
    await expect(findWorkspaceRoot('/ws')).rejects.toThrow();
  });
});
