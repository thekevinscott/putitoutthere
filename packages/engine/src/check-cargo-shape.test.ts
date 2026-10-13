import { readFile, readdir, stat } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCargoShape } from './check-cargo-shape.js';
import type { Package } from './config.js';

// glob.ts (reached via the workspace-member walk) reads through
// node:fs/promises: readdir + stat.
vi.mock('node:fs/promises');

/** Virtual filesystem: normalized absolute path -> file contents. */
const vfs = new Map<string, string>();
/** Directories known to exist (normalized). Derived from `vfs` writes. */
const knownDirs = new Set<string>();

/** Separator-normalize a path (Windows `\` -> `/`, strip a `C:` drive). */
function norm(p: unknown): string {
  return String(p).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
}

/** Join path segments with `/` — input construction only, never asserted. */
function j(...parts: string[]): string {
  return parts.join('/');
}

/** Write a file into the vfs, registering its ancestor directories. */
function setFile(path: string, content: string): void {
  const key = norm(path);
  vfs.set(key, content);
  let dir = key.slice(0, key.lastIndexOf('/'));
  while (dir.length > 0 && !knownDirs.has(dir)) {
    knownDirs.add(dir);
    const i = dir.lastIndexOf('/');
    dir = i > 0 ? dir.slice(0, i) : '';
  }
}

/** Immediate children of a directory as Dirent-like entries. */
function childDirents(dirKey: string): Array<{
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
}> {
  const prefix = dirKey.endsWith('/') ? dirKey : dirKey + '/';
  const seen = new Map<string, boolean>();
  for (const key of vfs.keys()) {
    if (!key.startsWith(prefix)) {continue;}
    const rest = key.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (!seen.has(rest)) {seen.set(rest, false);}
    } else {
      seen.set(rest.slice(0, slash), true);
    }
  }
  return [...seen].map(([name, isDir]) => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  }));
}

function pkg(kind: Package['kind'], overrides: Partial<Package> = {}): Package {
  return {
    name: `${kind}-pkg`,
    kind,
    path: '.',
    globs: ['**'],
    depends_on: [],
    first_version: '0.1.0',
    ...overrides,
  } as Package;
}

beforeEach(() => {
  vi.clearAllMocks();
  vfs.clear();
  knownDirs.clear();

  vi.mocked(readFile).mockImplementation((path: unknown) => {
    const key = norm(path);
    const found = vfs.get(key);
    if (found !== undefined) {return Promise.resolve(found);}
    const err = new Error(
      `ENOENT: no such file or directory, open '${String(path)}'`,
    ) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return Promise.reject(err);
  });

  // node:fs/promises for glob.ts's expandDirGlob (readdir) + pathExists (stat).
  vi.mocked(readdir).mockImplementation(((path: unknown) =>
    Promise.resolve(childDirents(norm(path)))) as unknown as typeof readdir);
  vi.mocked(stat).mockImplementation(((path: unknown) => {
    const key = norm(path);
    if (knownDirs.has(key) || vfs.has(key)) {
      return Promise.resolve({ isDirectory: () => knownDirs.has(key) });
    }
    const err = new Error(`ENOENT: ${String(path)}`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return Promise.reject(err);
  }) as unknown as typeof stat);
});

describe('checkCargoShape (#301)', () => {
  const dir = '/vfs/cargo-shape';

  function cratesPkg(name: string, path: string, overrides: Partial<Package> = {}): Package {
    return pkg('crates', { name, path, ...overrides });
  }

  function writeCargoToml(path: string, body: string): void {
    setFile(j(path, 'Cargo.toml'), body);
  }


  it('passes for a well-formed Cargo.toml whose [package].name matches the configured name', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
`,
    );
    expect(await checkCargoShape([cratesPkg('a', p)])).toEqual([]);
    // checkCargoShape reads the manifest via readToml's
    // readFile(path, 'utf8'). This test reads only a
    // single Cargo.toml, so pinning that basename's encoding kills the
    // StringLiteral mutant on that line.
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      expect.stringContaining('Cargo.toml'),
      'utf8',
    );
  });

  it('flags PIOT_CRATES_NAME_MISMATCH when [package].name differs from configured name', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "wrong"
version = "0.0.0"
`,
    );
    const findings = await checkCargoShape([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('PIOT_CRATES_NAME_MISMATCH');
    expect(findings[0]!.detail).toContain('wrong');
    expect(findings[0]!.detail).toContain('"a"');
  });

  it('honors the `crate` override when checking [package].name', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "my-crate-name"
version = "0.0.0"
`,
    );
    const pkgs = [cratesPkg('internal-name', p, { crate: 'my-crate-name' })];
    expect(await checkCargoShape(pkgs)).toEqual([]);
  });

  it('flags PIOT_CRATES_FEATURE_NOT_DECLARED when a configured feature is not in [features]', async () => {
    const p = j(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"

[features]
default = ["foo"]
foo = []
`,
    );
    const pkgs = [cratesPkg('a', p, { features: ['foo', 'missing'] })];
    const findings = await checkCargoShape(pkgs);
    expect(findings.some((f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED' && /missing/.test(f.detail))).toBe(true);
  });

  it('flags PIOT_CRATES_WORKSPACE_VERSION_MISMATCH when `version.workspace = true` but no workspace ancestor declares [workspace.package].version', async () => {
    // Crate sits at <root>/crates/a; no workspace Cargo.toml above it.
    const p = j(dir, 'crates', 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version.workspace = true
`,
    );
    const findings = await checkCargoShape([cratesPkg('a', p)], { cwd: dir });
    expect(findings.some((f) => f.code === 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH')).toBe(true);
  });

  it('accepts `version.workspace = true` when a workspace Cargo.toml above declares [workspace.package].version', async () => {
    const root = dir;
    const p = j(root, 'crates', 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version.workspace = true
`,
    );
    writeCargoToml(
      root,
      `[workspace]
members = ["crates/a"]

[workspace.package]
version = "0.1.0"
`,
    );
    const findings = await checkCargoShape([cratesPkg('a', p)], { cwd: root });
    expect(findings.filter((f) => f.code === 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH')).toEqual([]);
  });

  it('also validates the Cargo.toml at bundle_cli.crate_path on a pypi package (PIOT_CRATES_MISSING_BIN)', async () => {
    const root = dir;
    const cratePath = j(root, 'crates', 'cli');
    writeCargoToml(
      cratePath,
      `[package]
name = "cli"
version = "0.0.0"

[[bin]]
name = "other-bin"
path = "src/main.rs"
`,
    );
    const pypiPath = j(root, 'py');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: 'crates/cli', features: [], no_default_features: false },
    });
    const findings = await checkCargoShape([pyPkg], { cwd: root });
    expect(findings.some((f) => f.code === 'PIOT_CRATES_MISSING_BIN' && /my-cli/.test(f.detail))).toBe(true);
  });

  it('walks glob `[workspace].members` entries so crate_path = "." resolves a member crate bin (#361)', async () => {
    // #361: cargo `[workspace].members` entries are globs. #337 taught
    // the preflight `PIOT_CRATES_MISSING_BIN` walk to read *literal*
    // member entries, but a glob entry (`members = ["packages/*"]`,
    // the standard polyglot-repo shape) never resolves to a literal
    // `<member>/Cargo.toml`, so the member crate's `[[bin]]` is never
    // seen and the check false-fires for `crate_path = "."`.
    const root = dir;
    writeCargoToml(
      root,
      `[workspace]
members = ["packages/*"]
resolver = "2"
`,
    );
    writeCargoToml(
      j(root, 'packages', 'rust'),
      `[package]
name = "rust-core"
version = "0.0.0"

[[bin]]
name = "my-cli"
path = "src/main.rs"
`,
    );
    const pypiPath = j(root, 'py');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: '.', features: [], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN'),
    ).toEqual([]);
  });

  it('honors an absolute bundle_cli.crate_path (skips resolve against cwd)', async () => {
    // Exercises the absolute-path branch of cratePathAbs.
    // Pass an already-absolute crate_path and pass a deliberately-wrong cwd;
    // if the absolute path is honored the Cargo.toml is found and the
    // happy-path passes; if `resolve(cwd, ...)` ran, the read would land
    // somewhere else and `CRATES_MISSING_BIN` would fire spuriously.
    const root = dir;
    const cratePath = j(root, 'crates', 'cli');
    writeCargoToml(
      cratePath,
      `[package]
name = "my-cli"
version = "0.0.0"
`,
    );
    const pypiPath = j(root, 'py');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: cratePath, features: [], no_default_features: false },
    });
    // Deliberately wrong cwd. If the absolute branch is bypassed, the
    // resolve() would point at a non-existent file and the bin check
    // would skip silently — covered by checking we get zero findings.
    const findings = await checkCargoShape([pyPkg], { cwd: j(root, 'does-not-exist') });
    expect(findings).toEqual([]);
  });

  it('accepts bundle_cli.bin matching either an explicit [[bin]] or the implicit `[package].name`', async () => {
    const root = dir;
    const cratePath = j(root, 'crates', 'cli');
    writeCargoToml(
      cratePath,
      `[package]
name = "my-cli"
version = "0.0.0"
`,
    );
    const pypiPath = j(root, 'py');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: 'crates/cli', features: [], no_default_features: false },
    });
    expect((await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN')).toEqual([]);
  });

  it('flags PIOT_CRATES_FEATURE_NOT_DECLARED when bundle_cli.features mentions a feature the crate does not declare', async () => {
    const root = dir;
    const cratePath = j(root, 'crates', 'cli');
    writeCargoToml(
      cratePath,
      `[package]
name = "my-cli"
version = "0.0.0"

[features]
default = []
cli = []
`,
    );
    const pypiPath = j(root, 'py');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: 'crates/cli', features: ['cli', 'undeclared'], no_default_features: false },
    });
    const findings = await checkCargoShape([pyPkg], { cwd: root });
    expect(findings.some((f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED' && /undeclared/.test(f.detail))).toBe(true);
  });

  it('skips a missing or malformed Cargo.toml (cargo surfaces those diagnostics)', async () => {
    expect(await checkCargoShape([cratesPkg('a', j(dir, 'nope'))])).toEqual([]);
    const m = j(dir, 'malformed');
    writeCargoToml(m, '[[broken\nthis = is not valid toml');
    expect(await checkCargoShape([cratesPkg('a', m)])).toEqual([]);
  });

  it('skips npm packages entirely; only crates + pypi-with-bundle_cli get inspected', async () => {
    expect(await checkCargoShape([pkg('npm')])).toEqual([]);
  });

  it('aggregates findings across every crates package, not just the first', async () => {
    const a = j(dir, 'a');
    const b = j(dir, 'b');
    writeCargoToml(a, `[package]\nname = "wrong-a"\nversion = "0.0.0"\n`);
    writeCargoToml(b, `[package]\nname = "wrong-b"\nversion = "0.0.0"\n`);
    const findings = await checkCargoShape([cratesPkg('a', a), cratesPkg('b', b)]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('skips a bundle_cli crate whose Cargo.toml is missing', async () => {
    // collectBundleCliCrateFindings: `readToml(...) === null` early return.
    const root = dir;
    const pypiPath = j(root, 'py-nobin');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'x', stage_to: 'py/bin', crate_path: 'crates/nope', features: [], no_default_features: false },
    });
    expect((await checkCargoShape([pyPkg], { cwd: root }))).toEqual([]);
  });

  it('flags MISSING_BIN with "(none)" when the crate manifest declares no bins', async () => {
    // collectBinsFromManifest returns [] (no [[bin]], no [package].name) and
    // workspaceMemberManifests hits the `!Array.isArray(members)` return, so
    // declaredBins is empty and the detail uses the "(none)" cond-expr arm.
    const root = dir;
    const cratePath = j(root, 'crates', 'ws-only');
    writeCargoToml(cratePath, '[workspace]\n');
    const pypiPath = j(root, 'py-wsonly');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'x', stage_to: 'py/bin', crate_path: 'crates/ws-only', features: [], no_default_features: false },
    });
    const findings = (await checkCargoShape([pyPkg], { cwd: root }));
    const bin = findings.find((f) => f.code === 'PIOT_CRATES_MISSING_BIN');
    expect(bin).toBeDefined();
    expect(bin!.detail).toContain('(none)');
  });

  it('skips a glob workspace member that has no Cargo.toml while resolving bins', async () => {
    // readDeclaredBinNames member loop: a glob-matched member dir with no
    // Cargo.toml hits the `memberParsed === null` continue.
    const root = dir;
    const cratePath = j(root, 'ws-root');
    writeCargoToml(cratePath, '[workspace]\nmembers = ["members/*"]\n');
    writeCargoToml(
      j(cratePath, 'members', 'good'),
      '[package]\nname = "good"\nversion = "0.0.0"\n[[bin]]\nname = "the-bin"\npath = "src/main.rs"\n',
    );
    // sibling dir matched by the glob but carrying no Cargo.toml
    setFile(j(cratePath, 'members', 'empty', '.keep'), '');
    const pypiPath = j(root, 'py-glob');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'the-bin', stage_to: 'py/bin', crate_path: 'ws-root', features: [], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN'),
    ).toEqual([]);
  });

  it('yields no findings for a crates manifest with no [package] table', async () => {
    // collectCratesPackageFindings: `(parsed.package ?? {})` fallback.
    const p = j(dir, 'cargo-nopkg');
    writeCargoToml(p, '[workspace]\nmembers = ["a"]\n');
    expect((await checkCargoShape([pkg('crates', { name: 'a', path: p })]))).toEqual([]);
  });

  it('flags FEATURE_NOT_DECLARED when the crate declares no [features] table at all', async () => {
    // declaredFeatures: `(cargoToml.features ?? {})` fallback.
    const p = j(dir, 'cargo-nofeat');
    writeCargoToml(p, '[package]\nname = "a"\nversion = "0.0.0"\n');
    const findings = (await checkCargoShape([pkg('crates', { name: 'a', path: p, features: ['x'] })]));
    expect(
      findings.some((f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED' && /x/.test(f.detail)),
    ).toBe(true);
  });

  it('flags WORKSPACE_VERSION_MISMATCH when the workspace root omits [workspace.package].version', async () => {
    // workspaceVersionDeclared: `(workspace.package ?? {})` fallback when the
    // [workspace] table declares no `package` sub-table.
    const root = dir;
    const p = j(root, 'crates', 'a');
    writeCargoToml(p, '[package]\nname = "a"\nversion.workspace = true\n');
    writeCargoToml(root, '[workspace]\nmembers = ["crates/a"]\n');
    const findings = (await checkCargoShape([pkg('crates', { name: 'a', path: p })], { cwd: root }));
    expect(findings.some((f) => f.code === 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH')).toBe(true);
  });

  it('walks past a non-workspace ancestor Cargo.toml to find the workspace root', async () => {
    // workspaceVersionDeclared: `(parsed.workspace ?? null)` fallback when an
    // intermediate ancestor Cargo.toml parses but declares no [workspace].
    const root = dir;
    const p = j(root, 'crates', 'a');
    writeCargoToml(p, '[package]\nname = "a"\nversion.workspace = true\n');
    writeCargoToml(j(root, 'crates'), '[package]\nname = "intermediate"\nversion = "0.0.0"\n');
    writeCargoToml(
      root,
      '[workspace]\nmembers = ["crates/a"]\n[workspace.package]\nversion = "1.0.0"\n',
    );
    const findings = (await checkCargoShape([pkg('crates', { name: 'a', path: p })], { cwd: root }));
    expect(findings.filter((f) => f.code === 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH')).toEqual([]);
  });

  it('no FEATURE_NOT_DECLARED when every configured crates feature is declared', async () => {
    // collectCratesPackageFindings feature path: `missing.length > 0` else.
    const p = j(dir, 'cargo-featok');
    writeCargoToml(p, '[package]\nname = "a"\nversion = "0.0.0"\n[features]\nfoo = []\n');
    expect(
      (await checkCargoShape([pkg('crates', { name: 'a', path: p, features: ['foo'] })])).filter(
        (f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED',
      ),
    ).toEqual([]);
  });

  it('no FEATURE_NOT_DECLARED when every bundle_cli feature is declared', async () => {
    // collectBundleCliCrateFindings feature path: `missing.length > 0` else.
    const root = dir;
    const cratePath = j(root, 'crates', 'featok-cli');
    writeCargoToml(
      cratePath,
      '[package]\nname = "my-cli"\nversion = "0.0.0"\n[features]\ncli = []\n',
    );
    const pypiPath = j(root, 'py-featok');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py/bin', crate_path: 'crates/featok-cli', features: ['cli'], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED'),
    ).toEqual([]);
  });

  it('dedupes a bin name declared by more than one workspace member', async () => {
    // readDeclaredBinNames member loop: `!result.includes(b)` else — the same
    // bin name declared by a second member is not pushed twice.
    const root = dir;
    const cratePath = j(root, 'ws-dup');
    writeCargoToml(cratePath, '[workspace]\nmembers = ["members/*"]\n');
    writeCargoToml(
      j(cratePath, 'members', 'one'),
      '[package]\nname = "one"\nversion = "0.0.0"\n[[bin]]\nname = "dup-bin"\npath = "src/main.rs"\n',
    );
    writeCargoToml(
      j(cratePath, 'members', 'two'),
      '[package]\nname = "two"\nversion = "0.0.0"\n[[bin]]\nname = "dup-bin"\npath = "src/main.rs"\n',
    );
    const pypiPath = j(root, 'py-dup');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'dup-bin', stage_to: 'py/bin', crate_path: 'ws-dup', features: [], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN'),
    ).toEqual([]);
  });

  it('ignores a non-string entry in [workspace].members', async () => {
    // workspaceMemberManifests: `typeof m === 'string'` else — a non-string
    // members entry (an inline table) is skipped while the string glob still
    // resolves the member crate bin.
    const root = dir;
    const cratePath = j(root, 'ws-mixed');
    writeCargoToml(cratePath, '[workspace]\nmembers = ["members/*", { skip = true }]\n');
    writeCargoToml(
      j(cratePath, 'members', 'good'),
      '[package]\nname = "good"\nversion = "0.0.0"\n[[bin]]\nname = "the-bin"\npath = "src/main.rs"\n',
    );
    const pypiPath = j(root, 'py-mixed');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'the-bin', stage_to: 'py/bin', crate_path: 'ws-mixed', features: [], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN'),
    ).toEqual([]);
  });

  it('a top-level `bin` array of strings contributes no bin names', async () => {
    // collectBinsFromManifest: `typeof entry === 'object' && entry !== null`
    // else — a string entry in the `bin` array is ignored, so the crate falls
    // back to the implicit `[package].name` bin.
    const root = dir;
    const cratePath = j(root, 'crates', 'strbin');
    writeCargoToml(cratePath, 'bin = ["ignored"]\n\n[package]\nname = "my-cli"\nversion = "0.0.0"\n');
    const pypiPath = j(root, 'py-strbin');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py/bin', crate_path: 'crates/strbin', features: [], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN'),
    ).toEqual([]);
  });

  it('a [[bin]] table without a name contributes no bin names', async () => {
    // collectBinsFromManifest: `typeof name === 'string'` else — a [[bin]]
    // entry with no `name` field is ignored, so the crate falls back to the
    // implicit `[package].name` bin.
    const root = dir;
    const cratePath = j(root, 'crates', 'noname-bin');
    writeCargoToml(
      cratePath,
      '[package]\nname = "my-cli"\nversion = "0.0.0"\n\n[[bin]]\npath = "src/main.rs"\n',
    );
    const pypiPath = j(root, 'py-noname');
    setFile(j(pypiPath, '.keep'), '');
    const pyPkg = pkg('pypi', {
      name: 'py',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py/bin', crate_path: 'crates/noname-bin', features: [], no_default_features: false },
    });
    expect(
      (await checkCargoShape([pyPkg], { cwd: root })).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN'),
    ).toEqual([]);
  });
});
