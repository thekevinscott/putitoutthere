/**
 * Unit tests for the npm bundled-cli launcher author (#299). `normalizeBuild`
 * and the pure generators run for real. Path assertions use basename
 * `endsWith` only — never a separator-bearing literal — so they hold on
 * Windows, macOS, and Linux alike.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeLauncher } from './write-launcher.js';

vi.mock('node:fs/promises');

const readFileMock = vi.mocked(readFile);
const writeMock = vi.mocked(writeFile);
const mkdirMock = vi.mocked(mkdir);

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

    // The launcher's parent dir is created recursively.
    expect(mkdirMock).toHaveBeenCalledWith(expect.anything(), { recursive: true });
    // The launcher is written exclusively (`flag: 'wx'`) as utf8 text, so a
    // consumer-authored launcher wins the race via EEXIST.
    expect(writeMock).toHaveBeenCalledWith(
      expect.stringContaining('my-cli.js'),
      expect.anything(),
      { encoding: 'utf8', flag: 'wx' },
    );
    // package.json is read and rewritten as utf8 text.
    expect(readFileMock).toHaveBeenCalledWith(expect.stringContaining('package.json'), 'utf8');
    expect(writeMock).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
      expect.anything(),
      'utf8',
    );

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

  it('keeps the package.json indentation when adding bin', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ name: 'my-cli' }, null, 4));
    await writeLauncher({ ...baseOpts, pkgDir: 'pkg', triples: ['x86_64-unknown-linux-gnu'] });
    expect(writtenTo('package.json')).toBe(
      JSON.stringify({ name: 'my-cli', bin: { 'my-cli': 'bin/my-cli.js' } }, null, 4),
    );
  });

  it('writes a single-line package.json with 2-space indentation', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ name: 'my-cli' }));
    await writeLauncher({ ...baseOpts, pkgDir: 'pkg', triples: ['x86_64-unknown-linux-gnu'] });
    expect(writtenTo('package.json')).toBe(
      JSON.stringify({ name: 'my-cli', bin: { 'my-cli': 'bin/my-cli.js' } }, null, 2),
    );
  });

  it('rethrows a non-EEXIST error from the exclusive launcher write', async () => {
    // EEXIST is the consumer-override race we swallow; any other write
    // failure (e.g. EACCES) must propagate rather than be silently absorbed.
    writeMock.mockImplementation((_path, _data, opts) => {
      if (typeof opts === 'object' && opts !== null && opts.flag === 'wx') {
        return Promise.reject(
          Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
        );
      }
      return Promise.resolve();
    });
    readFileMock.mockResolvedValue(pkgJson());
    await expect(
      writeLauncher({ ...baseOpts, pkgDir: 'pkg', triples: ['x86_64-unknown-linux-gnu'] }),
    ).rejects.toThrow(/EACCES/);
  });
});
