import { dirname, join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expandDirGlob } from './expand-dir-glob.js';
import { workspaceMemberManifests } from './workspace-member-manifests.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./expand-dir-glob.js');

const manifestPath = join('/repo', 'Cargo.toml');

beforeEach(() => {
  vi.mocked(expandDirGlob).mockReset();
  vi.mocked(expandDirGlob).mockImplementation((base, pattern) =>
    Promise.resolve(pattern === 'crates/*' ? [join(base, 'crates', 'a'), join(base, 'crates', 'b')] : [join(base, pattern)]),
  );
});

describe('workspaceMemberManifests', () => {
  it('expands every string member glob against the workspace dir', async () => {
    expect(
      await workspaceMemberManifests({ workspace: { members: ['crates/*', 7, 'tools'] } }, manifestPath),
    ).toEqual([
      join('/repo', 'crates', 'a', 'Cargo.toml'),
      join('/repo', 'crates', 'b', 'Cargo.toml'),
      join('/repo', 'tools', 'Cargo.toml'),
    ]);
    expect(expandDirGlob).toHaveBeenCalledTimes(2);
    expect(expandDirGlob).toHaveBeenCalledWith(dirname(manifestPath), 'crates/*');
  });

  it('returns nothing without a [workspace] table or a members array', async () => {
    expect(await workspaceMemberManifests({}, manifestPath)).toEqual([]);
    expect(await workspaceMemberManifests({ workspace: null }, manifestPath)).toEqual([]);
    expect(await workspaceMemberManifests({ workspace: 'yes' }, manifestPath)).toEqual([]);
    expect(await workspaceMemberManifests({ workspace: { members: 'crates/*' } }, manifestPath)).toEqual([]);
    expect(expandDirGlob).not.toHaveBeenCalled();
  });
});
