import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectBinsFromManifest } from './collect-bins-from-manifest.js';
import { readDeclaredBinNames } from './read-declared-bin-names.js';
import { readToml } from './read-toml.js';
import { workspaceMemberManifests } from './workspace-member-manifests.js';

vi.mock('./collect-bins-from-manifest.js');
vi.mock('./read-toml.js');
vi.mock('./workspace-member-manifests.js');

const root = { workspace: { members: ['m/*'] } };
const memberA = { package: { name: 'a' } };
const memberB = { package: { name: 'b' } };

beforeEach(() => {
  vi.mocked(collectBinsFromManifest).mockReset();
  vi.mocked(readToml).mockReset();
  vi.mocked(workspaceMemberManifests).mockReset();
  vi.mocked(collectBinsFromManifest).mockImplementation((m) => {
    if (m === root) {return ['root-bin'];}
    if (m === memberA) {return ['shared', 'a-bin'];}
    if (m === memberB) {return ['shared', 'root-bin'];}
    return [];
  });
  vi.mocked(workspaceMemberManifests).mockResolvedValue([]);
});

describe('readDeclaredBinNames', () => {
  it('returns the manifest\'s own bins when it has no workspace members', async () => {
    expect(await readDeclaredBinNames(root, '/repo/Cargo.toml')).toEqual(['root-bin']);
    expect(workspaceMemberManifests).toHaveBeenCalledWith(root, '/repo/Cargo.toml');
  });

  it('appends each member crate\'s bins once, skipping unreadable members', async () => {
    vi.mocked(workspaceMemberManifests).mockResolvedValue([
      '/repo/m/a/Cargo.toml',
      '/repo/m/gone/Cargo.toml',
      '/repo/m/b/Cargo.toml',
    ]);
    vi.mocked(readToml).mockImplementation((path) =>
      Promise.resolve(
        path === '/repo/m/a/Cargo.toml' ? memberA : path === '/repo/m/b/Cargo.toml' ? memberB : null,
      ),
    );
    expect(await readDeclaredBinNames(root, '/repo/Cargo.toml')).toEqual([
      'root-bin',
      'shared',
      'a-bin',
    ]);
    expect(readToml).toHaveBeenCalledTimes(3);
  });
});
