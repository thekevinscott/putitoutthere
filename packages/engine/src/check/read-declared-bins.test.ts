import { describe, expect, it, vi } from 'vitest';

import { parseCargoToml } from './parse-cargo-toml.js';
import { readDeclaredBins } from './read-declared-bins.js';
import { workspaceMemberManifests } from './workspace-member-manifests.js';

vi.mock('./parse-cargo-toml.js');
vi.mock('./workspace-member-manifests.js');

describe('readDeclaredBins', () => {
  it('returns empty when the root manifest is missing or malformed', async () => {
    vi.mocked(parseCargoToml).mockResolvedValue(null);
    expect(await readDeclaredBins('/ws/Cargo.toml')).toEqual([]);
    expect(workspaceMemberManifests).not.toHaveBeenCalled();
  });

  it('reads bins from a plain (non-workspace) manifest', async () => {
    vi.mocked(parseCargoToml).mockResolvedValue({ bin: [{ name: 'root-bin' }] });
    vi.mocked(workspaceMemberManifests).mockResolvedValue([]);
    expect(await readDeclaredBins('/ws/Cargo.toml')).toEqual(['root-bin']);
  });

  it('merges member-crate bins with dedupe and skips unparseable members', async () => {
    const manifests: Record<string, Record<string, unknown> | null> = {
      '/ws/Cargo.toml': { package: { name: 'root' } },
      '/ws/crates/a/Cargo.toml': { bin: [{ name: 'root' }, { name: 'abin' }] },
      '/ws/crates/b/Cargo.toml': null,
    };
    vi.mocked(parseCargoToml).mockImplementation((path) => Promise.resolve(manifests[path] ?? null));
    vi.mocked(workspaceMemberManifests).mockResolvedValue([
      '/ws/crates/a/Cargo.toml',
      '/ws/crates/b/Cargo.toml',
    ]);
    expect(await readDeclaredBins('/ws/Cargo.toml')).toEqual(['root', 'abin']);
    expect(workspaceMemberManifests).toHaveBeenCalledWith(
      { package: { name: 'root' } },
      '/ws/Cargo.toml',
    );
  });
});
