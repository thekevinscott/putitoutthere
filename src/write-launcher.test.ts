import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectIndent,
  generateLauncherSource,
  nodePlatformKey,
  writeLauncher,
  writeLauncherFromConfig,
} from './write-launcher.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'write-launcher-test-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function writeMainPkg(name = 'my-cli'): string {
  const dir = join(repo, 'pkg');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0' }, null, 2),
  );
  return dir;
}

describe('writeLauncher (#299)', () => {
  it('writes bin/<bin>.js and updates package.json#bin when both are absent', () => {
    const pkgDir = writeMainPkg('my-cli');
    const written = writeLauncher({
      pkgDir,
      npmName: 'my-cli',
      bin: 'my-cli',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'],
    });

    const launcher = join(pkgDir, 'bin', 'my-cli.js');
    expect(written).toContain(launcher);
    expect(written).toContain(join(pkgDir, 'package.json'));

    const src = readFileSync(launcher, 'utf8');
    // Standard launcher shape: hashbang, triples table, spawnSync, exit.
    expect(src).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(src).toContain("'linux-x64': 'x86_64-unknown-linux-gnu'");
    expect(src).toContain("'darwin-arm64': 'aarch64-apple-darwin'");
    expect(src).toContain('my-cli-${triple}');
    expect(src).toContain("require.resolve(`${pkg}/my-cli");
    expect(src).toContain("'.exe'");
    expect(src).toMatch(/spawnSync/);

    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    expect(pkgJson.bin).toEqual({ 'my-cli': 'bin/my-cli.js' });
  });

  it('does not overwrite an existing bin/<bin>.js (consumer override wins)', () => {
    const pkgDir = writeMainPkg('my-cli');
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    const existing = '// custom launcher\nconsole.log("hi");\n';
    writeFileSync(join(pkgDir, 'bin', 'my-cli.js'), existing, 'utf8');

    const written = writeLauncher({
      pkgDir,
      npmName: 'my-cli',
      bin: 'my-cli',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });

    expect(written).not.toContain(join(pkgDir, 'bin', 'my-cli.js'));
    expect(readFileSync(join(pkgDir, 'bin', 'my-cli.js'), 'utf8')).toBe(existing);
  });

  it('does not overwrite an existing package.json#bin (consumer override wins)', () => {
    const pkgDir = writeMainPkg('my-cli');
    const pkgJson = join(pkgDir, 'package.json');
    writeFileSync(
      pkgJson,
      JSON.stringify(
        { name: 'my-cli', version: '0.0.0', bin: { 'my-cli': 'dist/cli.js' } },
        null,
        2,
      ),
    );

    writeLauncher({
      pkgDir,
      npmName: 'my-cli',
      bin: 'my-cli',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });

    const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(parsed.bin).toEqual({ 'my-cli': 'dist/cli.js' });
  });

  it('writes package.json#bin even if bin/<bin>.js exists (and vice versa)', () => {
    const pkgDir = writeMainPkg('my-cli');
    // Existing launcher but no bin field. The function should still
    // populate the bin field without touching the launcher.
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    const existing = '// preexisting\n';
    writeFileSync(join(pkgDir, 'bin', 'my-cli.js'), existing, 'utf8');

    writeLauncher({
      pkgDir,
      npmName: 'my-cli',
      bin: 'my-cli',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });

    expect(readFileSync(join(pkgDir, 'bin', 'my-cli.js'), 'utf8')).toBe(existing);
    const parsed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    expect(parsed.bin).toEqual({ 'my-cli': 'bin/my-cli.js' });
  });

  it('preserves the trailing newline in package.json when present', () => {
    const pkgDir = writeMainPkg('my-cli');
    // Rewrite package.json with a trailing newline so the
    // newline-preservation branch is exercised.
    const pkgJsonPath = join(pkgDir, 'package.json');
    writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: 'my-cli', version: '0.0.0' }, null, 2) + '\n',
    );
    writeLauncher({
      pkgDir,
      npmName: 'my-cli',
      bin: 'my-cli',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    expect(readFileSync(pkgJsonPath, 'utf8').endsWith('\n')).toBe(true);
  });

  it('errors on unsupported platform at runtime (generated launcher prints bin name)', () => {
    const pkgDir = writeMainPkg('my-cli');
    writeLauncher({
      pkgDir,
      npmName: 'my-cli',
      bin: 'my-cli',
      platformNameTemplate: '{name}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    const src = readFileSync(join(pkgDir, 'bin', 'my-cli.js'), 'utf8');
    // The launcher's unsupported-platform branch identifies the CLI by
    // name so a user sees "my-cli: unsupported platform ..." rather than
    // an opaque exit.
    expect(src).toContain('my-cli: unsupported platform');
  });

  it('resolves {name} / {scope} / {base} placeholders in the template', () => {
    const pkgDir = writeMainPkg('@myorg/cli');
    writeLauncher({
      pkgDir,
      npmName: '@myorg/cli',
      bin: 'my-cli',
      platformNameTemplate: '@myorg/cli-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    const src = readFileSync(join(pkgDir, 'bin', 'my-cli.js'), 'utf8');
    // The template constants get inlined at generation time; `{triple}`
    // becomes the runtime template substitution.
    expect(src).toContain('`@myorg/cli-${triple}`');
  });
});

describe('internals (#299)', () => {
  it('nodePlatformKey throws on an unmapped triple', () => {
    // Plan-time guard normally rejects unmapped triples before this
    // function runs, so reaching the throw means TRIPLE_MAP /
    // RUST_TARGET_KEYS have drifted. The vocabulary matches
    // `targetToOsCpu` so the drift is obvious in the error message.
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
      pkgDir: '/tmp/unused',
      npmName: '@myorg/cli',
      bin: 'my-cli',
      platformNameTemplate: '@myorg/{base}-{triple}',
      triples: ['x86_64-unknown-linux-gnu'],
    });
    expect(src).toContain('`@myorg/cli-${triple}`');
  });
});

describe('writeLauncherFromConfig (#299)', () => {
  function writeRepo(toml: string, mainPkgName: string, mainPkgPath = 'packages/ts'): void {
    mkdirSync(join(repo, mainPkgPath), { recursive: true });
    writeFileSync(
      join(repo, mainPkgPath, 'package.json'),
      JSON.stringify({ name: mainPkgName, version: '0.0.0' }, null, 2),
    );
    writeFileSync(join(repo, 'putitoutthere.toml'), toml, 'utf8');
  }

  it('writes a launcher for a bundled-cli package using the configured triples + template', () => {
    writeRepo(
      `[putitoutthere]
version = 1
[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = "bundled-cli"
targets = [
  "x86_64-unknown-linux-gnu",
  "aarch64-apple-darwin",
]
[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`,
      'my-cli',
    );

    const written = writeLauncherFromConfig({
      cwd: repo,
      packagePath: 'packages/ts',
    });
    expect(written.length).toBeGreaterThan(0);
    const launcher = readFileSync(
      join(repo, 'packages/ts/bin/my-cli.js'),
      'utf8',
    );
    expect(launcher).toContain("'linux-x64': 'x86_64-unknown-linux-gnu'");
    expect(launcher).toContain("'darwin-arm64': 'aarch64-apple-darwin'");
    expect(launcher).toContain('`my-cli-${triple}`');
  });

  it('uses the bundled-cli entry from a multi-mode build array (ignores napi entries)', () => {
    writeRepo(
      `[putitoutthere]
version = 1
[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = [
  { mode = "napi",        name = "@my-cli/lib-{triple}" },
  { mode = "bundled-cli", name = "@my-cli/cli-{triple}" },
]
targets = ["x86_64-unknown-linux-gnu"]
[package.bundle_cli]
bin = "my-cli"
crate_path = "."
`,
      'my-cli',
    );

    writeLauncherFromConfig({ cwd: repo, packagePath: 'packages/ts' });
    const launcher = readFileSync(
      join(repo, 'packages/ts/bin/my-cli.js'),
      'utf8',
    );
    // The launcher must use the bundled-cli family's template, not the
    // napi family's. The napi family carries .node addons, not binaries.
    expect(launcher).toContain('`@my-cli/cli-${triple}`');
    expect(launcher).not.toContain('@my-cli/lib-');
  });

  it('accepts an absolute packagePath', () => {
    writeRepo(
      `[putitoutthere]
version = 1
[[package]]
name = "my-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]
[package.bundle_cli]
bin = "my-cli"
crate_path = "."
`,
      'my-cli',
    );
    const written = writeLauncherFromConfig({
      cwd: repo,
      packagePath: join(repo, 'packages/ts'),
    });
    expect(written.length).toBeGreaterThan(0);
  });

  it('is a no-op for non-npm packages', () => {
    writeRepo(
      `[putitoutthere]
version = 1
[[package]]
name = "demo"
kind = "crates"
path = "."
globs = ["**"]
`,
      'demo',
      '.',
    );
    // Crates packages have no `path/bin/...` concept; the function
    // should return [] without touching the filesystem.
    const written = writeLauncherFromConfig({ cwd: repo, packagePath: '.' });
    expect(written).toEqual([]);
    expect(existsSync(join(repo, 'bin'))).toBe(false);
  });

  it('is a no-op when the package is npm but not bundled-cli', () => {
    writeRepo(
      `[putitoutthere]
version = 1
[[package]]
name = "demo"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
`,
      'demo',
    );
    const written = writeLauncherFromConfig({ cwd: repo, packagePath: 'packages/ts' });
    expect(written).toEqual([]);
    expect(existsSync(join(repo, 'packages/ts/bin'))).toBe(false);
  });

  it('handles a single-line (un-indented) package.json without losing the bin field', () => {
    // `detectIndent`'s fallback returns 2 when no indented quote
    // matches. Exercising it here also pins the runtime contract:
    // writing the launcher into a minified package.json still
    // produces a parseable file with the new `bin` entry.
    mkdirSync(join(repo, 'pkg'), { recursive: true });
    writeFileSync(
      join(repo, 'pkg', 'package.json'),
      JSON.stringify({ name: 'demo-cli', version: '0.0.0' }),
    );
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `[putitoutthere]
version = 1
[[package]]
name = "demo-cli"
kind = "npm"
path = "pkg"
globs = ["pkg/**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]
[package.bundle_cli]
bin = "demo-cli"
crate_path = "."
`,
      'utf8',
    );
    writeLauncherFromConfig({ cwd: repo, packagePath: 'pkg' });
    const parsed = JSON.parse(readFileSync(join(repo, 'pkg/package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    expect(parsed.bin).toEqual({ 'demo-cli': 'bin/demo-cli.js' });
  });

  it('errors when no package in the config has the given path', () => {
    writeRepo(
      `[putitoutthere]
version = 1
[[package]]
name = "demo"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
`,
      'demo',
    );
    expect(() =>
      writeLauncherFromConfig({ cwd: repo, packagePath: 'packages/other' }),
    ).toThrow(/no \[\[package\]\] entry/);
  });
});
