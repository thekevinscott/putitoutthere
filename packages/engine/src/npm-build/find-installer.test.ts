import { join, resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pathExists } from '../utils/path-exists.js';
import { findInstaller } from './find-installer.js';

vi.mock('../utils/path-exists.js');

const exists = vi.mocked(pathExists);
const root = resolve('/repo');
const member = join(root, 'packages', 'a');

function present(...paths: string[]): void {
  const set = new Set(paths);
  exists.mockImplementation((p) => Promise.resolve(set.has(p)));
}

beforeEach(() => {
  exists.mockReset();
});

describe('findInstaller', () => {
  it('a local package-lock.json selects npm', async () => {
    present(join(member, 'package-lock.json'));
    expect(await findInstaller(member, root)).toBe('npm');
  });

  it('a local pnpm-lock.yaml selects pnpm', async () => {
    present(join(member, 'pnpm-lock.yaml'));
    expect(await findInstaller(member, root)).toBe('pnpm');
  });

  it('an ancestor pnpm-lock.yaml selects pnpm (#721)', async () => {
    present(join(root, 'pnpm-lock.yaml'));
    expect(await findInstaller(member, root)).toBe('pnpm');
  });

  it('an ancestor pnpm-workspace.yaml alone selects pnpm (#721)', async () => {
    present(join(root, 'pnpm-workspace.yaml'));
    expect(await findInstaller(member, root)).toBe('pnpm');
  });

  it('an ancestor package-lock.json selects npm (#721)', async () => {
    present(join(root, 'package-lock.json'));
    expect(await findInstaller(member, root)).toBe('npm');
  });

  it('package-lock.json beats pnpm files in the same directory', async () => {
    present(join(member, 'package-lock.json'), join(member, 'pnpm-lock.yaml'), join(member, 'pnpm-workspace.yaml'));
    expect(await findInstaller(member, root)).toBe('npm');
  });

  it('the nearest directory wins', async () => {
    present(join(root, 'package-lock.json'), join(member, 'pnpm-workspace.yaml'));
    expect(await findInstaller(member, root)).toBe('pnpm');
  });

  it('checks the boundary itself, then stops', async () => {
    present(join(root, 'pnpm-workspace.yaml'), join(resolve('/'), 'package-lock.json'));
    expect(await findInstaller(member, root)).toBe('pnpm');
    present(join(resolve('/'), 'package-lock.json'));
    expect(await findInstaller(member, root)).toBe('none');
    expect(exists).not.toHaveBeenCalledWith(join(resolve('/'), 'package-lock.json'));
  });

  it('a package dir that is the boundary checks only itself', async () => {
    present(join(resolve('/'), 'pnpm-lock.yaml'));
    expect(await findInstaller(root, root)).toBe('none');
    expect(exists).toHaveBeenCalledTimes(3);
  });

  it('stops at the filesystem root when the boundary is never reached', async () => {
    present();
    expect(await findInstaller(member, resolve('/elsewhere'))).toBe('none');
    expect(exists).toHaveBeenCalledWith(join(resolve('/'), 'pnpm-workspace.yaml'));
  });
});
