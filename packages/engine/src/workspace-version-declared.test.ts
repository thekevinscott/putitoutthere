import { join, resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readToml } from './read-toml.js';
import { workspaceVersionDeclared } from './workspace-version-declared.js';

vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./read-toml.js');

const repo = resolve('/repo');
const crateToml = join(repo, 'crates', 'a', 'Cargo.toml');
let manifests: Map<string, Record<string, unknown>>;

beforeEach(() => {
  manifests = new Map();
  vi.mocked(readToml).mockReset();
  vi.mocked(readToml).mockImplementation((path) => Promise.resolve(manifests.get(path) ?? null));
});

describe('workspaceVersionDeclared', () => {
  it('is true when an ancestor [workspace.package] declares a version', async () => {
    manifests.set(join(repo, 'Cargo.toml'), { workspace: { package: { version: '1.0.0' } } });
    expect(await workspaceVersionDeclared(crateToml, repo)).toBe(true);
  });

  it('starts above the package directory, never reading the package\'s own Cargo.toml', async () => {
    manifests.set(crateToml, { workspace: { package: { version: '1.0.0' } } });
    expect(await workspaceVersionDeclared(crateToml, repo)).toBe(false);
    expect(readToml).not.toHaveBeenCalledWith(crateToml);
    expect(readToml).toHaveBeenCalledWith(join(repo, 'crates', 'Cargo.toml'));
    expect(readToml).toHaveBeenCalledWith(join(repo, 'Cargo.toml'));
  });

  it('walks past an ancestor without a [workspace] table', async () => {
    manifests.set(join(repo, 'crates', 'Cargo.toml'), { package: { name: 'mid' } });
    manifests.set(join(repo, 'Cargo.toml'), { workspace: { package: { version: '2.0.0' } } });
    expect(await workspaceVersionDeclared(crateToml, repo)).toBe(true);
  });

  it('is false when the nearest workspace omits or blanks the version', async () => {
    manifests.set(join(repo, 'crates', 'Cargo.toml'), { workspace: {} });
    manifests.set(join(repo, 'Cargo.toml'), { workspace: { package: { version: '1.0.0' } } });
    expect(await workspaceVersionDeclared(crateToml, repo)).toBe(false);
    manifests.set(join(repo, 'crates', 'Cargo.toml'), { workspace: { package: { version: ' ' } } });
    expect(await workspaceVersionDeclared(crateToml, repo)).toBe(false);
  });

  it('stops at cwd without reading above it', async () => {
    manifests.set(join(repo, 'Cargo.toml'), { workspace: { package: { version: '1.0.0' } } });
    const cwd = join(repo, 'crates');
    expect(await workspaceVersionDeclared(crateToml, cwd)).toBe(false);
    expect(readToml).toHaveBeenCalledTimes(1);
  });

  it('stops at the filesystem root when cwd is not an ancestor', async () => {
    expect(await workspaceVersionDeclared(crateToml, join(repo, 'elsewhere'))).toBe(false);
    expect(readToml).toHaveBeenLastCalledWith(join(resolve('/'), 'Cargo.toml'));
  });
});
