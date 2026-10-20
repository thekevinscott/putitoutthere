import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './load-config.js';
import { writeLauncher } from './write-launcher.js';
import { writeLauncherFromConfig } from './write-launcher-from-config.js';

vi.mock('./load-config.js');
vi.mock('./write-launcher.js');

const loadConfigMock = vi.mocked(loadConfig);
const writeLauncherMock = vi.mocked(writeLauncher);

interface CfgPkg {
  name: string;
  kind: string;
  path: string;
  build?: unknown;
  targets?: unknown;
  bundle_cli?: unknown;
  npm?: string;
}

function withConfig(pkgs: CfgPkg[]): void {
  loadConfigMock.mockResolvedValue({ packages: pkgs } as unknown as Awaited<ReturnType<typeof loadConfig>>);
}

const bundled = (extra: Partial<CfgPkg> = {}): CfgPkg => ({
  name: 'my-cli',
  kind: 'npm',
  path: 'packages/ts',
  build: 'bundled-cli',
  targets: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
  bundle_cli: { bin: 'my-bin', crate_path: 'crates/my-cli' },
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  writeLauncherMock.mockResolvedValue(['written']);
});

describe('writeLauncherFromConfig (#299)', () => {
  it('delegates the matched bundled-cli package to writeLauncher and returns its result', async () => {
    withConfig([bundled()]);
    await expect(writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' })).resolves.toEqual(['written']);
    expect(loadConfigMock).toHaveBeenCalledWith(expect.stringMatching(/^repo[\\/]putitoutthere\.toml$/));
    const { pkgDir, ...rest } = writeLauncherMock.mock.calls[0]![0];
    expect(pkgDir).toMatch(/repo[\\/]packages[\\/]ts$/);
    expect(rest).toEqual({
      npmName: 'my-cli',
      bin: 'my-bin',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
    });
  });

  it('loads the config from configPath when given', async () => {
    withConfig([bundled()]);
    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts', configPath: 'elsewhere.toml' });
    expect(loadConfigMock).toHaveBeenCalledWith('elsewhere.toml');
  });

  it('prefers the npm name over the package name', async () => {
    withConfig([bundled({ npm: '@acme/cli' })]);
    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    expect(writeLauncherMock.mock.calls[0]![0].npmName).toBe('@acme/cli');
  });

  it('resolves object-form targets via their `triple` field', async () => {
    withConfig([bundled({ targets: [{ triple: 'x86_64-unknown-linux-gnu' }, 'aarch64-apple-darwin'] })]);
    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    expect(writeLauncherMock.mock.calls[0]![0].triples).toEqual(['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin']);
  });

  it('uses the bundled-cli entry from a multi-mode build array (ignores napi entries)', async () => {
    withConfig([
      bundled({
        build: [
          { mode: 'napi', name: '@my-cli/lib-{triple}' },
          { mode: 'bundled-cli', name: '@my-cli/cli-{triple}' },
        ],
      }),
    ]);
    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    expect(writeLauncherMock.mock.calls[0]![0].platformNameTemplate).toBe('@my-cli/cli-{triple}');
  });

  it('matches an absolute packagePath against the resolved package path', async () => {
    const abs = process.cwd();
    withConfig([bundled({ name: 'other', path: 'packages/other' }), bundled({ path: abs })]);
    await writeLauncherFromConfig({ cwd: 'repo', packagePath: abs });
    expect(writeLauncherMock.mock.calls[0]![0].pkgDir).toBe(abs);
  });

  it('picks the package whose path matches, not the first one', async () => {
    withConfig([bundled({ name: 'a', path: 'packages/a' }), bundled({ name: 'b', path: 'packages/b' })]);
    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/b' });
    expect(writeLauncherMock.mock.calls[0]![0].npmName).toBe('b');
  });

  it('is a no-op for non-npm packages', async () => {
    withConfig([{ name: 'demo', kind: 'crates', path: '.' }]);
    await expect(writeLauncherFromConfig({ cwd: 'repo', packagePath: '.' })).resolves.toEqual([]);
    expect(writeLauncherMock).not.toHaveBeenCalled();
  });

  it('is a no-op for a non-npm package even when it carries bundled-cli fields', async () => {
    withConfig([bundled({ kind: 'crates' })]);
    await expect(writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' })).resolves.toEqual([]);
    expect(writeLauncherMock).not.toHaveBeenCalled();
  });

  it('is a no-op for an npm package with bundle_cli but no bundled-cli build entry', async () => {
    withConfig([bundled({ build: 'napi' })]);
    await expect(writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' })).resolves.toEqual([]);
    expect(writeLauncherMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the package is npm but not bundled-cli', async () => {
    withConfig([{ name: 'demo', kind: 'npm', path: 'packages/ts' }]);
    await expect(writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' })).resolves.toEqual([]);
    expect(writeLauncherMock).not.toHaveBeenCalled();
  });

  it('is a no-op for a bundled-cli npm package that omits [package.bundle_cli] (#298)', async () => {
    withConfig([bundled({ bundle_cli: undefined })]);
    await expect(writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' })).resolves.toEqual([]);
    expect(writeLauncherMock).not.toHaveBeenCalled();
  });

  it('names the path and default config file when no package matches', async () => {
    withConfig([bundled()]);
    await expect(
      writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/other' }),
    ).rejects.toThrow(
      /^write-launcher: no \[\[package\]\] entry with path "packages\/other" in repo[\\/]putitoutthere\.toml$/,
    );
  });

  it('names the configPath override when no package matches', async () => {
    withConfig([bundled()]);
    await expect(
      writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/other', configPath: 'x.toml' }),
    ).rejects.toThrow(new Error('write-launcher: no [[package]] entry with path "packages/other" in x.toml'));
  });
});
