import { describe, expect, it, vi } from 'vitest';

import { expandDirGlob } from '../glob.js';
import { workspaceMemberManifests } from './workspace-member-manifests.js';

vi.mock('../glob.js');

describe('workspaceMemberManifests', () => {
  it('returns empty when the manifest has no [workspace] table', async () => {
    expect(await workspaceMemberManifests({}, '/ws/Cargo.toml')).toEqual([]);
    expect(expandDirGlob).not.toHaveBeenCalled();
  });

  it('returns empty when [workspace] is explicitly null', async () => {
    expect(await workspaceMemberManifests({ workspace: null }, '/ws/Cargo.toml')).toEqual([]);
  });

  it('returns empty when [workspace].members is not an array', async () => {
    expect(
      await workspaceMemberManifests({ workspace: { members: 'crates/*' } }, '/ws/Cargo.toml'),
    ).toEqual([]);
  });

  it('expands member globs against the workspace dir and appends Cargo.toml', async () => {
    vi.mocked(expandDirGlob).mockResolvedValue(['/ws/crates/a', '/ws/crates/b']);
    expect(
      await workspaceMemberManifests(
        { workspace: { members: ['crates/*', 42] } },
        '/ws/Cargo.toml',
      ),
    ).toEqual(['/ws/crates/a/Cargo.toml', '/ws/crates/b/Cargo.toml']);
    expect(expandDirGlob).toHaveBeenCalledTimes(1);
    expect(expandDirGlob).toHaveBeenCalledWith('/ws', 'crates/*');
  });
});
