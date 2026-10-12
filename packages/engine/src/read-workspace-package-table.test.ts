import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readWorkspacePackageTable } from './read-workspace-package-table.js';

vi.mock('node:fs/promises');

const files = new Map<string, string>();
const dir = join('/vfs', 'crates-meta');

function writeCargoToml(path: string, ...lines: string[]): void {
  files.set(join(path, 'Cargo.toml'), lines.join('\n') + '\n');
}

beforeEach(() => {
  files.clear();
  vi.mocked(readFile).mockReset();
  vi.mocked(readFile).mockImplementation(((path: string) => {
    const found = files.get(path);
    return found === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(found);
  }) as unknown as typeof readFile);
});

describe('readWorkspacePackageTable (#328)', () => {
  it('returns the nearest workspace root\'s [workspace.package] table', async () => {
    writeCargoToml(dir, '[workspace]', 'members = ["a"]', '', '[workspace.package]', 'license = "MIT"');
    await expect(readWorkspacePackageTable(join(dir, 'a'))).resolves.toEqual({ license: 'MIT' });
    expect(readFile).toHaveBeenCalledWith(join(dir, 'Cargo.toml'), 'utf8');
  });

  it('walks past missing and malformed ancestors to reach the workspace root', async () => {
    writeCargoToml(dir, '[workspace]', '[workspace.package]', 'description = "Shared."');
    writeCargoToml(join(dir, 'nested'), '[[broken');
    await expect(readWorkspacePackageTable(join(dir, 'nested', 'deeper', 'a'))).resolves.toEqual({
      description: 'Shared.',
    });
  });

  it('stops at a workspace root that declares no [workspace.package] table', async () => {
    writeCargoToml('/vfs', '[workspace]', '[workspace.package]', 'license = "MIT"');
    writeCargoToml(dir, '[workspace]', 'members = ["a"]');
    await expect(readWorkspacePackageTable(join(dir, 'a'))).resolves.toBeUndefined();
  });

  it('stops at a workspace root whose package entry is not a table', async () => {
    writeCargoToml('/vfs', '[workspace]', '[workspace.package]', 'license = "MIT"');
    writeCargoToml(dir, '[workspace]', 'package = "flat"');
    await expect(readWorkspacePackageTable(join(dir, 'a'))).resolves.toBeUndefined();
  });

  it('returns undefined when no ancestor is a workspace root', async () => {
    writeCargoToml(dir, '[package]', 'name = "not-a-workspace"');
    await expect(readWorkspacePackageTable(join(dir, 'a'))).resolves.toBeUndefined();
  });

  it('never reads a Cargo.toml at the filesystem root', async () => {
    await expect(readWorkspacePackageTable(join('/vfs', 'a'))).resolves.toBeUndefined();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(join('/vfs', 'Cargo.toml'), 'utf8');
  });

  it('terminates on a relative crate path with no workspace ancestor', async () => {
    await expect(readWorkspacePackageTable('rel-crate')).resolves.toBeUndefined();
  });
});
