/**
 * Unit tests for the npm bundled-cli launcher author (#299).
 *
 * `node:fs` and the config loader (`loadConfig`, an fs collaborator) are
 * mocked so each case isolates the launcher-generation / override / bin-field
 * logic: `readFileSync` is driven with the package.json bytes and
 * `writeFileSync` is asserted against, with no real temp dir. `normalizeBuild`
 * and the pure generators run for real. The real on-disk round trip is
 * covered by the integration + e2e tiers.
 *
 * Path assertions use basename `endsWith` only — never a separator-bearing
 * literal — so they hold on Windows, macOS, and Linux alike.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';
import {
  detectIndent,
  generateLauncherSource,
  nodePlatformKey,
  writeLauncher,
  writeLauncherFromConfig,
} from './write-launcher.js';

vi.mock('node:fs/promises');
vi.mock('./config.js');

const readFileMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);
const loadConfigMock = vi.mocked(loadConfig);

/** The data (2nd arg) of the single writeFileSync whose path ends with `suffix`. */
function writtenTo(suffix: string): string | undefined {
  const call = writeMock.mock.calls.find(([p]) => (p as string).endsWith(suffix));
  // The engine always writes string contents on these paths.
  return call ? (call[1] as string) : undefined;
}

/** Was a writeFileSync issued against a path ending with `suffix`? */
function wroteTo(suffix: string): boolean {
  return writeMock.mock.calls.some(([p]) => (p as string).endsWith(suffix));
}

/** Make the launcher's write-exclusive (`flag: 'wx'`) call fail with EEXIST,
 *  modelling a consumer-authored launcher already on disk. */
function launcherAlreadyExists(): void {
  writeMock.mockImplementation((_path, _data, opts) => {
    if (typeof opts === 'object' && opts !== null && opts.flag === 'wx') {
      return Promise.reject(Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }));
    }
    return Promise.resolve();
  });
}

const pkgJson = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'my-cli', version: '0.0.0', ...extra }, null, 2);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writeLauncher (#299)', () => {
  const baseOpts = {
    npmName: 'my-cli',
    bin: 'my-cli',
    platformNameTemplate: '{name}-{triple}',
  };

  it('writes bin/<bin>.js and updates package.json#bin when both are absent', async () => {
    readFileMock.mockResolvedValue(pkgJson());
    const written = await writeLauncher({
      ...baseOpts,
      pkgDir: 'pkg',
      triples: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
    });

    expect(written.some((p) => p.endsWith('my-cli.js'))).toBe(true);
    expect(written.some((p) => p.endsWith('package.json'))).toBe(true);

    const src = writtenTo('my-cli.js')!;
    // Standard launcher shape: hashbang, triples table, spawnSync, exit.
    expect(src).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(src).toContain("'linux-x64': 'x86_64-unknown-linux-gnu'");
    expect(src).toContain("'darwin-arm64': 'aarch64-apple-darwin'");
    expect(src).toContain('my-cli-${triple}');
    expect(src).toContain("require.resolve(`${pkg}/my-cli");
    expect(src).toContain("'.exe'");
    expect(src).toMatch(/spawnSync/);

    const parsed = JSON.parse(writtenTo('package.json')!) as { bin?: Record<string, string> };
    expect(parsed.bin).toEqual({ 'my-cli': 'bin/my-cli.js' });
  });

  it('does not overwrite an existing bin/<bin>.js (consumer override wins)', async () => {
    launcherAlreadyExists();
    readFileMock.mockResolvedValue(pkgJson());
    const written = await writeLauncher({
      ...baseOpts,
      pkgDir: 'pkg',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    // The EEXIST launcher is not reported as written.
    expect(written.some((p) => p.endsWith('my-cli.js'))).toBe(false);
  });

  it('does not overwrite an existing package.json#bin (consumer override wins)', async () => {
    readFileMock.mockResolvedValue(pkgJson({ bin: { 'my-cli': 'dist/cli.js' } }));
    await writeLauncher({ ...baseOpts, pkgDir: 'pkg', triples: ['x86_64-unknown-linux-gnu'] });
    // A present bin field is left untouched — no package.json write at all.
    expect(wroteTo('package.json')).toBe(false);
  });

  it('writes package.json#bin even if bin/<bin>.js exists (and vice versa)', async () => {
    launcherAlreadyExists();
    readFileMock.mockResolvedValue(pkgJson());
    const written = await writeLauncher({
      ...baseOpts,
      pkgDir: 'pkg',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    // Launcher untouched (EEXIST) but the bin field is still populated.
    expect(written.some((p) => p.endsWith('my-cli.js'))).toBe(false);
    const parsed = JSON.parse(writtenTo('package.json')!) as { bin?: Record<string, string> };
    expect(parsed.bin).toEqual({ 'my-cli': 'bin/my-cli.js' });
  });

  it('preserves the trailing newline in package.json when present', async () => {
    readFileMock.mockResolvedValue(pkgJson() + '\n');
    await writeLauncher({ ...baseOpts, pkgDir: 'pkg', triples: ['x86_64-unknown-linux-gnu'] });
    expect(writtenTo('package.json')!.endsWith('\n')).toBe(true);
  });

  it('errors on unsupported platform at runtime (generated launcher prints bin name)', async () => {
    readFileMock.mockResolvedValue(pkgJson());
    await writeLauncher({ ...baseOpts, pkgDir: 'pkg', triples: ['x86_64-unknown-linux-gnu'] });
    // The launcher's unsupported-platform branch identifies the CLI by name.
    expect(writtenTo('my-cli.js')).toContain('my-cli: unsupported platform');
  });

  it('resolves {name} / {scope} / {base} placeholders in the template', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ name: '@myorg/cli', version: '0.0.0' }, null, 2));
    await writeLauncher({
      pkgDir: 'pkg',
      npmName: '@myorg/cli',
      bin: 'my-cli',
      platformNameTemplate: '@myorg/cli-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    // The template constants get inlined at generation time; `{triple}`
    // becomes the runtime template substitution.
    expect(writtenTo('my-cli.js')).toContain('`@myorg/cli-${triple}`');
  });
});

describe('internals (#299)', () => {
  it('nodePlatformKey throws on an unmapped triple', () => {
    expect(() => nodePlatformKey('totally-bogus-triple')).toThrow(
      /not mapped to Node platform\+arch/,
    );
  });

  it('nodePlatformKey maps both napi-rs short form and Rust triples', () => {
    expect(nodePlatformKey('linux-arm-gnueabihf')).toBe('linux-arm');
    expect(nodePlatformKey('aarch64-unknown-linux-musl')).toBe('linux-arm64');
    expect(nodePlatformKey('armv7-unknown-linux-gnueabihf')).toBe('linux-arm');
  });

  it('detectIndent returns 2 when no indented quote is found', () => {
    expect(detectIndent('{"a":1}')).toBe(2);
  });

  it('detectIndent recognises tab indentation', () => {
    expect(detectIndent('{\n\t"a": 1\n}')).toBe('\t');
  });

  it('generateLauncherSource resolves {scope} / {base} when called directly', () => {
    const src = generateLauncherSource({
      pkgDir: 'unused',
      npmName: '@myorg/cli',
      bin: 'my-cli',
      platformNameTemplate: '@myorg/{base}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    expect(src).toContain('`@myorg/cli-${triple}`');
  });
});

describe('writeLauncherFromConfig (#299)', () => {
  interface CfgPkg {
    name: string;
    kind: string;
    path: string;
    build?: unknown;
    targets?: unknown;
    bundle_cli?: unknown;
    npm?: string;
  }
  // Only the fields writeLauncherFromConfig reads are supplied; loadConfig is
  // mocked so no real putitoutthere.toml is parsed (config parsing is covered
  // by config.test.ts + the integration tier).
  function withConfig(pkgs: CfgPkg[]): void {
    loadConfigMock.mockResolvedValue({ packages: pkgs } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    readFileMock.mockResolvedValue(JSON.stringify({ name: 'my-cli', version: '0.0.0' }, null, 2));
  }

  it('writes a launcher for a bundled-cli package using the configured triples + template', async () => {
    withConfig([
      {
        name: 'my-cli',
        kind: 'npm',
        path: 'packages/ts',
        build: 'bundled-cli',
        targets: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
        bundle_cli: { bin: 'my-cli', crate_path: 'crates/my-cli' },
      },
    ]);

    const written = await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    expect(written.length).toBeGreaterThan(0);
    const launcher = writtenTo('my-cli.js')!;
    expect(launcher).toContain("'linux-x64': 'x86_64-unknown-linux-gnu'");
    expect(launcher).toContain("'darwin-arm64': 'aarch64-apple-darwin'");
    expect(launcher).toContain('`my-cli-${triple}`');
  });

  it('uses the bundled-cli entry from a multi-mode build array (ignores napi entries)', async () => {
    withConfig([
      {
        name: 'my-cli',
        kind: 'npm',
        path: 'packages/ts',
        build: [
          { mode: 'napi', name: '@my-cli/lib-{triple}' },
          { mode: 'bundled-cli', name: '@my-cli/cli-{triple}' },
        ],
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'my-cli', crate_path: '.' },
      },
    ]);

    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    const launcher = writtenTo('my-cli.js')!;
    // The launcher must use the bundled-cli family's template, not the napi
    // family's (napi carries .node addons, not binaries).
    expect(launcher).toContain('`@my-cli/cli-${triple}`');
    expect(launcher).not.toContain('@my-cli/lib-');
  });

  it('accepts an absolute packagePath', async () => {
    // `process.cwd()` is a native absolute path on every OS, so this
    // exercises the isAbsolute branch without a hardcoded (OS-specific)
    // path literal. pkg.path equals it, so resolve() matches on any OS.
    const abs = process.cwd();
    withConfig([
      {
        name: 'my-cli',
        kind: 'npm',
        path: abs,
        build: 'bundled-cli',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'my-cli', crate_path: '.' },
      },
    ]);
    const written = await writeLauncherFromConfig({ cwd: 'repo', packagePath: abs });
    expect(written.length).toBeGreaterThan(0);
  });

  it('is a no-op for non-npm packages', async () => {
    withConfig([{ name: 'demo', kind: 'crates', path: '.' }]);
    const written = await writeLauncherFromConfig({ cwd: 'repo', packagePath: '.' });
    expect(written).toEqual([]);
    // Nothing is written to disk.
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the package is npm but not bundled-cli', async () => {
    withConfig([{ name: 'demo', kind: 'npm', path: 'packages/ts' }]);
    const written = await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    expect(written).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('is a no-op for a bundled-cli npm package that omits [package.bundle_cli] (legacy bring-your-own-launcher path)', async () => {
    // #298 kept the legacy bundled-cli path opt-in: a package may omit
    // [package.bundle_cli] and ship its own bin/<bin>.js. Without the table
    // the engine has no binary name to author a launcher from, so it must
    // no-op rather than dereference the absent block.
    withConfig([
      {
        name: 'my-cli',
        kind: 'npm',
        path: 'packages/ts',
        build: ['bundled-cli', { mode: 'napi', name: '{name}-napi-{triple}' }],
        targets: ['x86_64-unknown-linux-gnu'],
      },
    ]);
    const written = await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/ts' });
    expect(written).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('handles a single-line (un-indented) package.json without losing the bin field', async () => {
    // detectIndent's fallback returns 2 when no indented quote matches;
    // a minified package.json still produces a parseable file with `bin`.
    loadConfigMock.mockResolvedValue({
      packages: [
        {
          name: 'demo-cli',
          kind: 'npm',
          path: 'pkg',
          build: 'bundled-cli',
          targets: ['x86_64-unknown-linux-gnu'],
          bundle_cli: { bin: 'demo-cli', crate_path: '.' },
        },
      ],
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);
    readFileMock.mockResolvedValue(JSON.stringify({ name: 'demo-cli', version: '0.0.0' }));

    await writeLauncherFromConfig({ cwd: 'repo', packagePath: 'pkg' });
    const parsed = JSON.parse(writtenTo('package.json')!) as { bin?: Record<string, string> };
    expect(parsed.bin).toEqual({ 'demo-cli': 'bin/demo-cli.js' });
  });

  it('errors when no package in the config has the given path', async () => {
    withConfig([{ name: 'demo', kind: 'npm', path: 'packages/ts' }]);
    await expect(
      writeLauncherFromConfig({ cwd: 'repo', packagePath: 'packages/other' }),
    ).rejects.toThrow(/no \[\[package\]\] entry/);
  });
});
