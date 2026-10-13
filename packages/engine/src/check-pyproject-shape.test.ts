import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPyprojectShape } from './check-pyproject-shape.js';
import type { Package } from './config.js';

vi.mock('node:fs/promises');

/** Virtual filesystem: normalized absolute path -> file contents. */
const vfs = new Map<string, string>();

/** Separator-normalize a path (Windows `\\` -> `/`, strip a `C:` drive). */
function norm(p: unknown): string {
  return String(p).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
}

/** Join path segments with `/` — input construction only, never asserted. */
function j(...parts: string[]): string {
  return parts.join('/');
}

function setFile(path: string, content: string): void {
  vfs.set(norm(path), content);
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
});

describe('checkPyprojectShape (#301)', () => {
  const dir = '/vfs/pyproject';

  function pypiPkg(
    name: string,
    path: string,
    overrides: Partial<Package> = {},
  ): Package {
    return pkg('pypi', { name, path, ...overrides });
  }

  function writePyproject(path: string, body: string): void {
    setFile(j(path, 'pyproject.toml'), body);
  }


  it('passes for a well-formed setuptools pyproject (name + backend match)', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "a"
version = "0.0.0"
`,
    );
    const pkgs = [pypiPkg('a', p, { build: 'setuptools' })];
    expect(await checkPyprojectShape(pkgs)).toEqual([]);
    // Pin the manifest read's encoding so a StringLiteral mutant dropping
    // 'utf8' from readFile(pyprojectPath, 'utf8') is killed.
    expect(vi.mocked(readFile)).toHaveBeenCalledWith(
      expect.stringContaining('pyproject.toml'),
      'utf8',
    );
  });

  it('passes for a well-formed maturin pyproject with bundle_cli include glob', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["maturin>=1"]
build-backend = "maturin"

[project]
name = "a"
version = "0.0.0"

[tool.maturin]
include = ["a/bin/*"]
`,
    );
    const pkgs = [
      pypiPkg('a', p, {
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'a/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    expect(await checkPyprojectShape(pkgs)).toEqual([]);
  });

  it('flags PIOT_PYPI_NAME_MISMATCH when [project].name differs from configured name', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "different-name"
version = "0.0.0"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('PIOT_PYPI_NAME_MISMATCH');
    expect(findings[0]!.detail).toContain('different-name');
    expect(findings[0]!.detail).toContain('"a"');
  });

  it('honors the `pypi` override when checking [project].name', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "my-pypi-name"
version = "0.0.0"
`,
    );
    const pkgs = [pypiPkg('internal-name', p, { build: 'setuptools', pypi: 'my-pypi-name' })];
    expect(await checkPyprojectShape(pkgs)).toEqual([]);
  });

  it('flags PIOT_PYPI_BUILD_BACKEND_MISMATCH when backend disagrees with `build`', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "a"
version = "0.0.0"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'maturin', targets: ['x86_64-unknown-linux-gnu'] })]);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_BUILD_BACKEND_MISMATCH')).toBe(true);
  });

  it('accepts each known backend prefix (maturin, setuptools, hatchling)', async () => {
    const cases: Array<['maturin' | 'setuptools' | 'hatch', string]> = [
      ['maturin', 'maturin'],
      ['setuptools', 'setuptools.build_meta'],
      ['hatch', 'hatchling.build'],
    ];
    for (const [build, backend] of cases) {
      const p = j(dir, `${backend.replace(/[^a-z]/g, '-')}`);
      writePyproject(
        p,
        `[build-system]
build-backend = "${backend}"

[project]
name = "a"
version = "0.0.0"
`,
      );
      const overrides: Partial<Package> =
        build === 'maturin'
          ? ({ build, targets: ['x86_64-unknown-linux-gnu'] })
          : ({ build });
      const pkgs = [pypiPkg('a', p, overrides)];
      const findings = await checkPyprojectShape(pkgs);
      expect(findings.filter((f) => f.code === 'PIOT_PYPI_BUILD_BACKEND_MISMATCH')).toEqual([]);
    }
  });

  it('flags PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND when dynamic = ["version"] has no version source', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "hatchling.build"

[project]
name = "a"
dynamic = ["version"]
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toBe(true);
  });

  it('flags PIOT_PYPI_HATCH_VERSION_PATH when [tool.hatch.version] reads a file in the tree', async () => {
    // Presence of a version table is not enough: hatchling's default
    // source reads a literal off `path`, which no release step rewrites
    // and which ignores SETUPTOOLS_SCM_PRETEND_VERSION, so the wheel
    // ships the previous release's version (#696).
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "a"
dynamic = ["version"]

[tool.hatch.version]
path = "a/__init__.py"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_HATCH_VERSION_PATH')).toBe(true);
  });

  it('accepts dynamic version when [tool.hatch.version] source = "vcs" and hatch-vcs is declared', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["hatchling", "hatch-vcs>=0.4"]
build-backend = "hatchling.build"

[project]
name = "a"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(
      findings.filter(
        (f) =>
          f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND' ||
          f.code === 'PIOT_PYPI_HATCH_VERSION_PATH',
      ),
    ).toEqual([]);
  });

  it('flags PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND when source = "vcs" but hatch-vcs is not in requires', async () => {
    // hatchling resolves `source = "vcs"` through hatch-vcs's plugin entry
    // point; without the plugin in requires the build dies mid-release
    // with `Unknown version source: vcs` (#696).
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "a"
dynamic = ["version"]

[tool.hatch.version]
source = "vcs"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    const found = findings.find((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND');
    expect(found).toBeDefined();
    expect(found!.detail).toContain('hatch-vcs');
  });

  it('accepts dynamic version on a maturin package without [tool.hatch.version] / [tool.setuptools_scm]', async () => {
    // maturin sources its version from Cargo.toml's [package].version, so a
    // dynamic = ["version"] maturin pyproject is well-formed without either
    // setuptools-scm or hatch-vcs declared — exercise that path so the
    // gate doesn't fire false positives on the maturin recipe.
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "maturin"

[project]
name = "a"
dynamic = ["version"]
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'maturin', targets: ['x86_64-unknown-linux-gnu'] })]);
    expect(findings.filter((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toEqual([]);
  });

  it('accepts dynamic version when [tool.setuptools_scm] is present', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["setuptools>=61", "setuptools-scm>=8"]
build-backend = "setuptools.build_meta"

[project]
name = "a"
dynamic = ["version"]

[tool.setuptools_scm]
write_to = "a/_version.py"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
    expect(findings.filter((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toEqual([]);
  });

  it('flags PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND when setuptools-scm is not in requires', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "a"
dynamic = ["version"]

[tool.setuptools_scm]
write_to = "a/_version.py"
`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
    const found = findings.find((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND');
    expect(found).toBeDefined();
    expect(found!.detail).toContain('setuptools-scm');
  });

  it('flags PIOT_PYPI_MATURIN_INCLUDE_MISSING when bundle_cli stage_to is not covered by [tool.maturin].include', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "maturin"

[project]
name = "a"
version = "0.0.0"

[tool.maturin]
include = ["docs/*"]
`,
    );
    const pkgs = [
      pypiPkg('a', p, {
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'a/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    const findings = await checkPyprojectShape(pkgs);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toBe(true);
  });

  it('flags PIOT_PYPI_MATURIN_INCLUDE_MISSING when [tool.maturin] table is absent entirely', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "maturin"

[project]
name = "a"
version = "0.0.0"
`,
    );
    const pkgs = [
      pypiPkg('a', p, {
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'a/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    expect((await checkPyprojectShape(pkgs)).some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toBe(true);
  });

  it('treats object-form maturin include entries without a `path` field as not covering', async () => {
    // Exercises `extractIncludePath`'s "object entry but no usable
    // string path" arm. The whole `include` list
    // collapses to "no covering entry", so MATURIN_INCLUDE_MISSING
    // fires.
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "maturin"

[project]
name = "a"
version = "0.0.0"

[tool.maturin]
include = [{ format = "wheel" }]
`,
    );
    const pkgs = [
      pypiPkg('a', p, {
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'a/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    const findings = await checkPyprojectShape(pkgs);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toBe(true);
  });

  it('accepts object-form maturin include entries with a `path` field', async () => {
    const p = j(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "maturin"

[project]
name = "a"
version = "0.0.0"

[tool.maturin]
include = [{ path = "a/bin/*", format = "wheel" }]
`,
    );
    const pkgs = [
      pypiPkg('a', p, {
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'a/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    expect((await checkPyprojectShape(pkgs)).filter((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toEqual([]);
  });

  it('skips non-pypi packages entirely', async () => {
    expect(await checkPyprojectShape([pkg('crates'), pkg('npm')])).toEqual([]);
  });

  it('skips a missing or malformed pyproject.toml (the publish path surfaces those)', async () => {
    const p = j(dir, 'missing');
    expect(await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })])).toEqual([]);
    const m = j(dir, 'malformed');
    writePyproject(m, '[[broken\nnot toml');
    expect(await checkPyprojectShape([pypiPkg('a', m, { build: 'setuptools' })])).toEqual([]);
  });

  it('aggregates findings across every pypi package, not just the first', async () => {
    const a = j(dir, 'a');
    const b = j(dir, 'b');
    writePyproject(a, `[build-system]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "wrong-a"\nversion = "0"\n`);
    writePyproject(b, `[build-system]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "wrong-b"\nversion = "0"\n`);
    const findings = await checkPyprojectShape([
      pypiPkg('a', a, { build: 'setuptools' }),
      pypiPkg('b', b, { build: 'setuptools' }),
    ]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('maturin include covering a parent dir of stage_to passes', async () => {
    // maturinIncludeCovers: `stage_to.startsWith(normalized + "/")` arm.
    const p = j(dir, 'mat-parent');
    writePyproject(
      p,
      `[build-system]\nbuild-backend = "maturin"\n[project]\nname = "a"\nversion = "0.0.0"\n[tool.maturin]\ninclude = ["pkg"]\n`,
    );
    const pkgs = [
      pkg('pypi', {
        name: 'a',
        path: p,
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'pkg/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    expect(
      (await checkPyprojectShape(pkgs)).filter((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING'),
    ).toEqual([]);
  });

  it('maturin include listing a child path of stage_to passes', async () => {
    // maturinIncludeCovers: the final `path.startsWith(stage_to + "/")` arm.
    const p = j(dir, 'mat-child');
    writePyproject(
      p,
      `[build-system]\nbuild-backend = "maturin"\n[project]\nname = "a"\nversion = "0.0.0"\n[tool.maturin]\ninclude = ["pkg/bin/inner"]\n`,
    );
    const pkgs = [
      pkg('pypi', {
        name: 'a',
        path: p,
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'pkg/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    expect(
      (await checkPyprojectShape(pkgs)).filter((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING'),
    ).toEqual([]);
  });

  it('yields no findings for a pyproject with neither [project] nor [build-system]', async () => {
    // Exercises both `(parsed.project ?? {})` and
    // `(parsed['build-system'] ?? {})` fallbacks.
    const p = j(dir, 'py-bare');
    writePyproject(p, '[tool.black]\nline-length = 88\n');
    expect((await checkPyprojectShape([pkg('pypi', { name: 'a', path: p, build: 'setuptools' })]))).toEqual([]);
  });

  it('a non-string maturin include entry does not cover stage_to', async () => {
    // extractIncludePath: an include entry that is neither a string nor an
    // object (a bare number) yields no path, so it cannot cover stage_to and
    // MATURIN_INCLUDE_MISSING fires.
    const p = j(dir, 'mat-numentry');
    writePyproject(
      p,
      `[build-system]\nbuild-backend = "maturin"\n[project]\nname = "a"\nversion = "0.0.0"\n[tool.maturin]\ninclude = [42]\n`,
    );
    const pkgs = [
      pkg('pypi', {
        name: 'a',
        path: p,
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'pkg/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    expect(
      (await checkPyprojectShape(pkgs)).some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING'),
    ).toBe(true);
  });

  it('ignores a pyproject that sits under a non-pypi package path', async () => {
    const p = j(dir, 'not-pypi');
    writePyproject(p, `[project]\nname = "other"\n`);
    expect(await checkPyprojectShape([pkg('crates', { name: 'a', path: p })])).toEqual([]);
  });

  it('pins the BUILD_BACKEND_MISMATCH detail, listing every accepted prefix', async () => {
    const p = j(dir, 'backend-detail');
    writePyproject(p, `[build-system]\nbuild-backend = "maturin"\n[project]\nname = "a"\n`);
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(findings.map((f) => ({ ...f, pyprojectPath: norm(f.pyprojectPath) }))).toEqual([
      {
        package: 'a',
        pyprojectPath: j(p, 'pyproject.toml'),
        code: 'PIOT_PYPI_BUILD_BACKEND_MISMATCH',
        detail: '[build-system].build-backend = "maturin" but build = "hatch" expects "hatchling*" or "hatch*"',
      },
    ]);
  });

  it('flags a setuptools package whose backend is hatchling', async () => {
    const p = j(dir, 'setuptools-hatch');
    writePyproject(p, `[build-system]\nbuild-backend = "hatchling.build"\n[project]\nname = "a"\n`);
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
    expect(findings.map((f) => f.code)).toEqual(['PIOT_PYPI_BUILD_BACKEND_MISMATCH']);
  });

  it('accepts a hatch backend that matches only one of the accepted prefixes', async () => {
    const p = j(dir, 'hatch-only');
    writePyproject(p, `[build-system]\nbuild-backend = "hatch.build"\n[project]\nname = "a"\n`);
    expect(await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })])).toEqual([]);
  });

  it('skips the backend check when build-backend is empty', async () => {
    const p = j(dir, 'empty-backend');
    writePyproject(p, `[build-system]\nbuild-backend = ""\n[project]\nname = "a"\n`);
    expect(await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })])).toEqual([]);
  });

  it('skips the backend check when build-backend is absent', async () => {
    const p = j(dir, 'no-backend');
    writePyproject(p, `[build-system]\nrequires = ["setuptools"]\n[project]\nname = "a"\n`);
    expect(await checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })])).toEqual([]);
  });

  it('classifies the version source when "version" is one of several dynamic fields', async () => {
    const p = j(dir, 'dyn-multi');
    writePyproject(
      p,
      `[build-system]\nbuild-backend = "hatchling.build"\n[project]\nname = "a"\ndynamic = ["readme", "version"]\n`,
    );
    const findings = await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(findings.map((f) => f.code)).toEqual(['PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND']);
  });

  it('does not classify the version source when "version" is not dynamic', async () => {
    const p = j(dir, 'dyn-readme');
    writePyproject(
      p,
      `[build-system]\nbuild-backend = "hatchling.build"\n[project]\nname = "a"\ndynamic = ["readme"]\n`,
    );
    expect(await checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })])).toEqual([]);
  });

  it('treats a non-array [tool.maturin].include as covering nothing, and pins the detail', async () => {
    const p = j(dir, 'mat-string-include');
    writePyproject(
      p,
      `[build-system]\nbuild-backend = "maturin"\n[project]\nname = "a"\n[tool.maturin]\ninclude = "a/bin"\n`,
    );
    const pkgs = [
      pypiPkg('a', p, {
        build: 'maturin',
        targets: ['x86_64-unknown-linux-gnu'],
        bundle_cli: { bin: 'a', stage_to: 'a/bin', crate_path: '.', features: [], no_default_features: false },
      }),
    ];
    const findings = await checkPyprojectShape(pkgs);
    expect(findings.map((f) => ({ ...f, pyprojectPath: norm(f.pyprojectPath) }))).toEqual([
      {
        package: 'a',
        pyprojectPath: j(p, 'pyproject.toml'),
        code: 'PIOT_PYPI_MATURIN_INCLUDE_MISSING',
        detail: 'bundle_cli.stage_to = "a/bin" is not covered by any [tool.maturin].include entry; the cross-compiled binary will not be packed into the wheel',
      },
    ]);
  });
});
