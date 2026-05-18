/**
 * Pre-flight check tests. Auth (§16.3) + npm provenance metadata (#280).
 *
 * Issue #14, #280.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAuth,
  checkCargoShape,
  checkCratesMetadata,
  checkProvenanceMetadata,
  checkPyprojectShape,
  checkRepoPublic,
  checkRepoUrlMatch,
  requireAuth,
  requireCargoShape,
  requireCratesMetadata,
  requireProvenanceMetadata,
  requirePyprojectShape,
  requireRepoPublic,
  requireRepoUrlMatch,
  type AuthStatus,
} from './preflight.js';
import type { Package } from './config.js';

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

const ENV_BAK = { ...process.env };
// Strip every auth-relevant variable so each test starts from a clean slate.
const AUTH_VARS = [
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'CARGO_REGISTRY_TOKEN',
  'PYPI_API_TOKEN',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
];

beforeEach(() => {
  for (const k of AUTH_VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) delete process.env[k];
  }
  Object.assign(process.env, ENV_BAK);
});

describe('checkAuth: per-handler requirements (§16.3 table)', () => {
  it('crates: passes with CARGO_REGISTRY_TOKEN', () => {
    process.env.CARGO_REGISTRY_TOKEN = 'tok';
    const status = checkAuth([pkg('crates')]);
    expect(status.ok).toBe(true);
    expect(status.results[0]).toMatchObject({
      package: 'crates-pkg',
      via: 'token',
    });
  });

  it('crates: passes with OIDC present', () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'x';
    const status = checkAuth([pkg('crates')]);
    expect(status.ok).toBe(true);
    expect(status.results[0]!.via).toBe('oidc');
  });

  it('crates: fails when neither OIDC nor token present', () => {
    const status = checkAuth([pkg('crates')]);
    expect(status.ok).toBe(false);
    expect(status.results[0]).toMatchObject({
      package: 'crates-pkg',
      via: 'missing',
      envVar: 'CARGO_REGISTRY_TOKEN',
    });
  });

  it('pypi: passes with OIDC', () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'x';
    expect(checkAuth([pkg('pypi')]).ok).toBe(true);
  });

  it('pypi: passes with PYPI_API_TOKEN', () => {
    process.env.PYPI_API_TOKEN = 'tok';
    expect(checkAuth([pkg('pypi')]).ok).toBe(true);
  });

  it('pypi: fails with neither', () => {
    const status = checkAuth([pkg('pypi')]);
    expect(status.ok).toBe(false);
    expect(status.results[0]!.envVar).toBe('PYPI_API_TOKEN');
  });

  it('npm: passes with OIDC', () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'x';
    expect(checkAuth([pkg('npm')]).ok).toBe(true);
  });

  it('npm: passes with NODE_AUTH_TOKEN', () => {
    process.env.NODE_AUTH_TOKEN = 'tok';
    const status = checkAuth([pkg('npm')]);
    expect(status.ok).toBe(true);
    expect(status.results[0]).toMatchObject({
      via: 'token',
      envVar: 'NODE_AUTH_TOKEN',
    });
  });

  it('npm: passes with NPM_TOKEN fallback', () => {
    process.env.NPM_TOKEN = 'tok';
    const status = checkAuth([pkg('npm')]);
    expect(status.ok).toBe(true);
    expect(status.results[0]).toMatchObject({
      via: 'token',
      envVar: 'NPM_TOKEN',
    });
  });

  it('npm: prefers NODE_AUTH_TOKEN when both are set', () => {
    process.env.NODE_AUTH_TOKEN = 'primary';
    process.env.NPM_TOKEN = 'fallback';
    const status = checkAuth([pkg('npm')]);
    expect(status.results[0]!.envVar).toBe('NODE_AUTH_TOKEN');
  });

  it('npm: falls through empty NODE_AUTH_TOKEN to NPM_TOKEN', () => {
    process.env.NODE_AUTH_TOKEN = '';
    process.env.NPM_TOKEN = 'tok';
    const status = checkAuth([pkg('npm')]);
    expect(status.ok).toBe(true);
    expect(status.results[0]!.envVar).toBe('NPM_TOKEN');
  });

  it('npm: fails with neither', () => {
    const status = checkAuth([pkg('npm')]);
    expect(status.ok).toBe(false);
    expect(status.results[0]).toMatchObject({
      via: 'missing',
      envVar: 'NODE_AUTH_TOKEN',
      acceptedEnvVars: ['NODE_AUTH_TOKEN', 'NPM_TOKEN'],
    });
  });
});

describe('checkAuth: empty token values are treated as missing', () => {
  it('empty string does not count as a token', () => {
    process.env.CARGO_REGISTRY_TOKEN = '';
    expect(checkAuth([pkg('crates')]).ok).toBe(false);
  });

  it('whitespace-only string does not count as a token', () => {
    process.env.CARGO_REGISTRY_TOKEN = '   ';
    expect(checkAuth([pkg('crates')]).ok).toBe(false);
  });
});

describe('checkAuth: multi-package rollup', () => {
  it('aggregates across every cascaded package', () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'x';
    const status = checkAuth([pkg('crates'), pkg('pypi'), pkg('npm')]);
    expect(status.ok).toBe(true);
    expect(status.results.map((r) => r.package).sort()).toEqual([
      'crates-pkg',
      'npm-pkg',
      'pypi-pkg',
    ]);
  });

  it('reports every missing package (not just the first)', () => {
    const status = checkAuth([pkg('crates'), pkg('pypi'), pkg('npm')]);
    expect(status.ok).toBe(false);
    const missing = status.results.filter((r) => r.via === 'missing');
    expect(missing.map((r) => r.envVar).sort()).toEqual([
      'CARGO_REGISTRY_TOKEN',
      'NODE_AUTH_TOKEN',
      'PYPI_API_TOKEN',
    ]);
  });

  it('empty package list is trivially ok', () => {
    const status: AuthStatus = checkAuth([]);
    expect(status.ok).toBe(true);
    expect(status.results).toEqual([]);
  });
});

describe('requireAuth', () => {
  it('returns silently when all packages pass', () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'x';
    expect(() => requireAuth([pkg('crates')])).not.toThrow();
  });

  it('throws with a message naming every missing env var + package', () => {
    expect(() =>
      requireAuth([pkg('crates'), pkg('pypi'), pkg('npm')]),
    ).toThrow(/CARGO_REGISTRY_TOKEN.*PYPI_API_TOKEN.*NODE_AUTH_TOKEN|PYPI_API_TOKEN/);
  });

  it('lists both npm env var names when npm auth is missing', () => {
    expect(() => requireAuth([pkg('npm')])).toThrow(/NODE_AUTH_TOKEN or NPM_TOKEN/);
  });

  it('throws with a pointer to the published auth guide (#144)', () => {
    expect(() => requireAuth([pkg('crates')])).toThrow(
      /thekevinscott\.github\.io\/putitoutthere\/guide\/auth/,
    );
  });

  it('does not reference internal plan.md sections in the error (#144)', () => {
    try {
      requireAuth([pkg('crates')]);
    } catch (err) {
      expect((err as Error).message).not.toMatch(/plan\.md/);
      expect((err as Error).message).not.toMatch(/§16\.4/);
      return;
    }
    throw new Error('expected requireAuth to throw');
  });
});

/* ----------------------- npm provenance metadata ----------------------- */

describe('checkProvenanceMetadata / requireProvenanceMetadata (#280)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piot-prov-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function npmPkg(name: string, path: string): Package {
    return pkg('npm', { name, path });
  }

  function writePkgJson(path: string, body: unknown): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify(body), 'utf8');
  }

  it('passes when an npm package has a non-empty repository.url object', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    });
    expect(checkProvenanceMetadata([npmPkg('a', p)])).toEqual([]);
    expect(() => requireProvenanceMetadata([npmPkg('a', p)])).not.toThrow();
  });

  it('passes when repository is the legacy non-empty string form', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/x/y.git',
    });
    expect(checkProvenanceMetadata([npmPkg('a', p)])).toEqual([]);
  });

  it('fails when repository is missing entirely', () => {
    const p = join(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0' });
    const findings = checkProvenanceMetadata([npmPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'a', reason: 'empty' });
  });

  it('fails when repository is an empty string', () => {
    const p = join(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0', repository: '' });
    expect(checkProvenanceMetadata([npmPkg('a', p)])).toHaveLength(1);
  });

  it('fails when repository is an object without a url', () => {
    const p = join(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0', repository: { type: 'git' } });
    expect(checkProvenanceMetadata([npmPkg('a', p)])).toHaveLength(1);
  });

  it('fails when repository.url is whitespace', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: '   ' },
    });
    expect(checkProvenanceMetadata([npmPkg('a', p)])).toHaveLength(1);
  });

  it('reports a missing package.json as a finding rather than crashing', () => {
    const p = join(dir, 'does-not-exist');
    const findings = checkProvenanceMetadata([npmPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.reason).toBe('missing');
  });

  it('skips non-npm packages entirely', () => {
    expect(checkProvenanceMetadata([pkg('crates'), pkg('pypi')])).toEqual([]);
  });

  it('reports every failing npm package, not just the first', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writePkgJson(a, { name: 'a', version: '0.0.0' });
    writePkgJson(b, { name: 'b', version: '0.0.0' });
    const findings = checkProvenanceMetadata([npmPkg('a', a), npmPkg('b', b)]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('throws with PIOT_NPM_MISSING_REPOSITORY when any npm package fails', () => {
    const p = join(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0' });
    expect(() => requireProvenanceMetadata([npmPkg('a', p)])).toThrow(
      /PIOT_NPM_MISSING_REPOSITORY/,
    );
  });

  it('error message names every failing package + its package.json path', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writePkgJson(a, { name: 'a', version: '0.0.0' });
    writePkgJson(b, { name: 'b', version: '0.0.0' });
    try {
      requireProvenanceMetadata([npmPkg('a', a), npmPkg('b', b)]);
      throw new Error('expected requireProvenanceMetadata to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('a');
      expect(msg).toContain('b');
      expect(msg).toContain(join(a, 'package.json'));
      expect(msg).toContain(join(b, 'package.json'));
    }
  });

  it('error message includes the canonical repository shape and a docs pointer', () => {
    const p = join(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0' });
    try {
      requireProvenanceMetadata([npmPkg('a', p)]);
      throw new Error('expected requireProvenanceMetadata to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('"repository"');
      expect(msg).toContain('"type": "git"');
      expect(msg).toContain('"url"');
      expect(msg).toContain('"directory"');
      expect(msg).toContain('github.com/thekevinscott/putitoutthere');
    }
  });

  it('returns silently when there are no npm packages in the cascade', () => {
    expect(() => requireProvenanceMetadata([pkg('crates'), pkg('pypi')])).not.toThrow();
  });
});

/* ----------------------- crates.io required metadata ----------------------- */

describe('checkCratesMetadata / requireCratesMetadata (#290)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piot-crates-meta-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cratesPkg(name: string, path: string): Package {
    return pkg('crates', { name, path });
  }

  function writeCargoToml(path: string, ...lines: string[]): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'Cargo.toml'), lines.join('\n') + '\n', 'utf8');
  }

  it('passes when description + license are both present', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      '[package]',
      'name = "a"',
      'version = "0.0.0"',
      'description = "A test crate."',
      'license = "MIT"',
    );
    expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
    expect(() => requireCratesMetadata([cratesPkg('a', p)])).not.toThrow();
  });

  it('accepts license-file in place of license', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      '[package]',
      'name = "a"',
      'version = "0.0.0"',
      'description = "A test crate."',
      'license-file = "LICENSE"',
    );
    expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
  });

  it('reports missing description', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      '[package]',
      'name = "a"',
      'version = "0.0.0"',
      'license = "MIT"',
    );
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'a', missing: ['description'] });
  });

  it('reports missing license when neither license nor license-file is set', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      '[package]',
      'name = "a"',
      'version = "0.0.0"',
      'description = "A test crate."',
    );
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'a', missing: ['license'] });
  });

  it('reports both fields together when both are missing', () => {
    const p = join(dir, 'a');
    writeCargoToml(p, '[package]', 'name = "a"', 'version = "0.0.0"');
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.missing).toEqual(['description', 'license']);
  });

  it('treats whitespace-only fields as empty', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      '[package]',
      'name = "a"',
      'version = "0.0.0"',
      'description = "   "',
      'license = ""',
    );
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.missing).toEqual(['description', 'license']);
  });

  it('skips a missing Cargo.toml (the handler surfaces that error)', () => {
    expect(checkCratesMetadata([cratesPkg('a', join(dir, 'nope'))])).toEqual([]);
  });

  it('skips a malformed Cargo.toml (cargo surfaces the diagnostic)', () => {
    const p = join(dir, 'a');
    writeCargoToml(p, '[[broken', 'this = is not valid toml');
    expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
  });

  it('skips non-crates packages entirely', () => {
    expect(checkCratesMetadata([pkg('npm'), pkg('pypi')])).toEqual([]);
  });

  it('reports every failing crates package, not just the first', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeCargoToml(a, '[package]', 'name = "a"', 'version = "0.0.0"');
    writeCargoToml(b, '[package]', 'name = "b"', 'version = "0.0.0"');
    const findings = checkCratesMetadata([cratesPkg('a', a), cratesPkg('b', b)]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('throws with PIOT_CRATES_MISSING_METADATA when any crates package fails', () => {
    const p = join(dir, 'a');
    writeCargoToml(p, '[package]', 'name = "a"', 'version = "0.0.0"');
    expect(() => requireCratesMetadata([cratesPkg('a', p)])).toThrow(
      /PIOT_CRATES_MISSING_METADATA/,
    );
  });

  it('error message names every failing package, its Cargo.toml path, and the missing fields', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeCargoToml(a, '[package]', 'name = "a"', 'version = "0.0.0"', 'license = "MIT"');
    writeCargoToml(b, '[package]', 'name = "b"', 'version = "0.0.0"', 'description = "x"');
    try {
      requireCratesMetadata([cratesPkg('a', a), cratesPkg('b', b)]);
      throw new Error('expected requireCratesMetadata to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('a');
      expect(msg).toContain('b');
      expect(msg).toContain(join(a, 'Cargo.toml'));
      expect(msg).toContain(join(b, 'Cargo.toml'));
      expect(msg).toContain('description');
      expect(msg).toContain('license');
    }
  });

  it('error message includes a docs pointer to the cargo manifest reference', () => {
    const p = join(dir, 'a');
    writeCargoToml(p, '[package]', 'name = "a"', 'version = "0.0.0"');
    try {
      requireCratesMetadata([cratesPkg('a', p)]);
      throw new Error('expected requireCratesMetadata to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('doc.rust-lang.org/cargo/reference/manifest.html');
    }
  });

  it('returns silently when there are no crates packages in the cascade', () => {
    expect(() => requireCratesMetadata([pkg('npm'), pkg('pypi')])).not.toThrow();
  });

  /*
   * `[workspace.package]` inheritance (#328).
   *
   * `cargo publish` resolves `license.workspace = true` against the
   * workspace root before upload, so crates.io receives the literal
   * value. The check must do the same — otherwise repos following
   * Cargo's recommended centralized-metadata pattern can't adopt
   * `check` without inlining redundant fields into every crate.
   */
  describe('workspace.package inheritance (#328)', () => {
    it('resolves license inherited via `license.workspace = true`', () => {
      writeCargoToml(
        dir,
        '[workspace]',
        'members = ["a"]',
        '',
        '[workspace.package]',
        'license = "MIT"',
      );
      const p = join(dir, 'a');
      writeCargoToml(
        p,
        '[package]',
        'name = "a"',
        'version = "0.0.0"',
        'description = "A test crate."',
        'license.workspace = true',
      );
      expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
    });

    it('resolves description inherited via `description.workspace = true`', () => {
      writeCargoToml(
        dir,
        '[workspace]',
        'members = ["a"]',
        '',
        '[workspace.package]',
        'description = "Inherited description."',
      );
      const p = join(dir, 'a');
      writeCargoToml(
        p,
        '[package]',
        'name = "a"',
        'version = "0.0.0"',
        'description.workspace = true',
        'license = "MIT"',
      );
      expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
    });

    it('resolves both fields when both inherit from `[workspace.package]`', () => {
      writeCargoToml(
        dir,
        '[workspace]',
        'members = ["a"]',
        '',
        '[workspace.package]',
        'description = "Shared."',
        'license = "Apache-2.0"',
      );
      const p = join(dir, 'a');
      writeCargoToml(
        p,
        '[package]',
        'name = "a"',
        'version = "0.0.0"',
        'description.workspace = true',
        'license.workspace = true',
      );
      expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
    });

    it('accepts license-file inherited from `[workspace.package]`', () => {
      writeCargoToml(
        dir,
        '[workspace]',
        'members = ["a"]',
        '',
        '[workspace.package]',
        'license-file = "LICENSE"',
      );
      const p = join(dir, 'a');
      writeCargoToml(
        p,
        '[package]',
        'name = "a"',
        'version = "0.0.0"',
        'description = "A test crate."',
        'license-file.workspace = true',
      );
      expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
    });

    it('still reports missing when the crate inherits but the workspace root omits the field', () => {
      // Workspace declares `description` but not `license`. The crate
      // tries to inherit both, so `license` remains unresolved and
      // crates.io would reject the publish.
      writeCargoToml(
        dir,
        '[workspace]',
        'members = ["a"]',
        '',
        '[workspace.package]',
        'description = "Only description shared."',
      );
      const p = join(dir, 'a');
      writeCargoToml(
        p,
        '[package]',
        'name = "a"',
        'version = "0.0.0"',
        'description.workspace = true',
        'license.workspace = true',
      );
      const findings = checkCratesMetadata([cratesPkg('a', p)]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ package: 'a', missing: ['license'] });
    });

    it('still reports missing when there is no `[workspace.package]` table to inherit from', () => {
      // Workspace root exists (a Cargo.toml with `[workspace]`) but
      // has no `[workspace.package]` block. Inherited fields resolve
      // to nothing, so the publish would fail.
      writeCargoToml(dir, '[workspace]', 'members = ["a"]');
      const p = join(dir, 'a');
      writeCargoToml(
        p,
        '[package]',
        'name = "a"',
        'version = "0.0.0"',
        'description.workspace = true',
        'license.workspace = true',
      );
      const findings = checkCratesMetadata([cratesPkg('a', p)]);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.missing).toEqual(['description', 'license']);
    });
  });
});

/* ----------------------- pyproject.toml shape (#301) ----------------------- */

describe('checkPyprojectShape / requirePyprojectShape (#301)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piot-pyproject-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function pypiPkg(
    name: string,
    path: string,
    overrides: Partial<Package> = {},
  ): Package {
    return pkg('pypi', { name, path, ...overrides });
  }

  function writePyproject(path: string, body: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'pyproject.toml'), body, 'utf8');
  }

  it('passes for a well-formed setuptools pyproject (name + backend match)', () => {
    const p = join(dir, 'a');
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
    expect(checkPyprojectShape(pkgs)).toEqual([]);
    expect(() => requirePyprojectShape(pkgs)).not.toThrow();
  });

  it('passes for a well-formed maturin pyproject with bundle_cli include glob', () => {
    const p = join(dir, 'a');
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
    expect(checkPyprojectShape(pkgs)).toEqual([]);
  });

  it('flags PIOT_PYPI_NAME_MISMATCH when [project].name differs from configured name', () => {
    const p = join(dir, 'a');
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
    const findings = checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('PIOT_PYPI_NAME_MISMATCH');
    expect(findings[0]!.detail).toContain('different-name');
    expect(findings[0]!.detail).toContain('"a"');
  });

  it('honors the `pypi` override when checking [project].name', () => {
    const p = join(dir, 'a');
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
    expect(checkPyprojectShape(pkgs)).toEqual([]);
  });

  it('flags PIOT_PYPI_BUILD_BACKEND_MISMATCH when backend disagrees with `build`', () => {
    const p = join(dir, 'a');
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
    const findings = checkPyprojectShape([pypiPkg('a', p, { build: 'maturin', targets: ['x86_64-unknown-linux-gnu'] })]);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_BUILD_BACKEND_MISMATCH')).toBe(true);
  });

  it('accepts each known backend prefix (maturin, setuptools, hatchling)', () => {
    const cases: Array<['maturin' | 'setuptools' | 'hatch', string]> = [
      ['maturin', 'maturin'],
      ['setuptools', 'setuptools.build_meta'],
      ['hatch', 'hatchling.build'],
    ];
    for (const [build, backend] of cases) {
      const p = join(dir, `${backend.replace(/[^a-z]/g, '-')}`);
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
      const findings = checkPyprojectShape(pkgs);
      expect(findings.filter((f) => f.code === 'PIOT_PYPI_BUILD_BACKEND_MISMATCH')).toEqual([]);
    }
  });

  it('flags PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND when dynamic = ["version"] has no version source', () => {
    const p = join(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "hatchling.build"

[project]
name = "a"
dynamic = ["version"]
`,
    );
    const findings = checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toBe(true);
  });

  it('accepts dynamic version when [tool.hatch.version] is present', () => {
    const p = join(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "hatchling.build"

[project]
name = "a"
dynamic = ["version"]

[tool.hatch.version]
path = "a/__init__.py"
`,
    );
    const findings = checkPyprojectShape([pypiPkg('a', p, { build: 'hatch' })]);
    expect(findings.filter((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toEqual([]);
  });

  it('accepts dynamic version on a maturin package without [tool.hatch.version] / [tool.setuptools_scm]', () => {
    // maturin sources its version from Cargo.toml's [package].version, so a
    // dynamic = ["version"] maturin pyproject is well-formed without either
    // setuptools-scm or hatch-vcs declared — exercise that path so the
    // gate doesn't fire false positives on the maturin recipe.
    const p = join(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "maturin"

[project]
name = "a"
dynamic = ["version"]
`,
    );
    const findings = checkPyprojectShape([pypiPkg('a', p, { build: 'maturin', targets: ['x86_64-unknown-linux-gnu'] })]);
    expect(findings.filter((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toEqual([]);
  });

  it('accepts dynamic version when [tool.setuptools_scm] is present', () => {
    const p = join(dir, 'a');
    writePyproject(
      p,
      `[build-system]
build-backend = "setuptools.build_meta"

[project]
name = "a"
dynamic = ["version"]

[tool.setuptools_scm]
write_to = "a/_version.py"
`,
    );
    const findings = checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
    expect(findings.filter((f) => f.code === 'PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND')).toEqual([]);
  });

  it('flags PIOT_PYPI_MATURIN_INCLUDE_MISSING when bundle_cli stage_to is not covered by [tool.maturin].include', () => {
    const p = join(dir, 'a');
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
    const findings = checkPyprojectShape(pkgs);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toBe(true);
  });

  it('flags PIOT_PYPI_MATURIN_INCLUDE_MISSING when [tool.maturin] table is absent entirely', () => {
    const p = join(dir, 'a');
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
    expect(checkPyprojectShape(pkgs).some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toBe(true);
  });

  it('treats object-form maturin include entries without a `path` field as not covering', () => {
    // Exercises `extractIncludePath`'s "object entry but no usable
    // string path" arm (preflight.ts:510). The whole `include` list
    // collapses to "no covering entry", so MATURIN_INCLUDE_MISSING
    // fires.
    const p = join(dir, 'a');
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
    const findings = checkPyprojectShape(pkgs);
    expect(findings.some((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toBe(true);
  });

  it('accepts object-form maturin include entries with a `path` field', () => {
    const p = join(dir, 'a');
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
    expect(checkPyprojectShape(pkgs).filter((f) => f.code === 'PIOT_PYPI_MATURIN_INCLUDE_MISSING')).toEqual([]);
  });

  it('skips non-pypi packages entirely', () => {
    expect(checkPyprojectShape([pkg('crates'), pkg('npm')])).toEqual([]);
  });

  it('skips a missing or malformed pyproject.toml (the publish path surfaces those)', () => {
    const p = join(dir, 'missing');
    expect(checkPyprojectShape([pypiPkg('a', p, { build: 'setuptools' })])).toEqual([]);
    const m = join(dir, 'malformed');
    writePyproject(m, '[[broken\nnot toml');
    expect(checkPyprojectShape([pypiPkg('a', m, { build: 'setuptools' })])).toEqual([]);
  });

  it('aggregates findings across every pypi package, not just the first', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writePyproject(a, `[build-system]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "wrong-a"\nversion = "0"\n`);
    writePyproject(b, `[build-system]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "wrong-b"\nversion = "0"\n`);
    const findings = checkPyprojectShape([
      pypiPkg('a', a, { build: 'setuptools' }),
      pypiPkg('b', b, { build: 'setuptools' }),
    ]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('requirePyprojectShape throws naming every failing package + the error code', () => {
    const p = join(dir, 'a');
    writePyproject(p, `[build-system]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "wrong"\nversion = "0"\n`);
    try {
      requirePyprojectShape([pypiPkg('a', p, { build: 'setuptools' })]);
      throw new Error('expected requirePyprojectShape to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('PIOT_PYPI_NAME_MISMATCH');
      expect(msg).toContain('a');
      expect(msg).toContain(join(p, 'pyproject.toml'));
    }
  });

  it('requirePyprojectShape returns silently when there are no pypi packages', () => {
    expect(() => requirePyprojectShape([pkg('crates'), pkg('npm')])).not.toThrow();
  });
});

/* ----------------------- Cargo.toml shape (#301) ----------------------- */

describe('checkCargoShape / requireCargoShape (#301)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piot-cargo-shape-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cratesPkg(name: string, path: string, overrides: Partial<Package> = {}): Package {
    return pkg('crates', { name, path, ...overrides });
  }

  function writeCargoToml(path: string, body: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'Cargo.toml'), body, 'utf8');
  }

  it('passes for a well-formed Cargo.toml whose [package].name matches the configured name', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
`,
    );
    expect(checkCargoShape([cratesPkg('a', p)])).toEqual([]);
    expect(() => requireCargoShape([cratesPkg('a', p)])).not.toThrow();
  });

  it('flags PIOT_CRATES_NAME_MISMATCH when [package].name differs from configured name', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "wrong"
version = "0.0.0"
`,
    );
    const findings = checkCargoShape([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('PIOT_CRATES_NAME_MISMATCH');
    expect(findings[0]!.detail).toContain('wrong');
    expect(findings[0]!.detail).toContain('"a"');
  });

  it('honors the `crate` override when checking [package].name', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "my-crate-name"
version = "0.0.0"
`,
    );
    const pkgs = [cratesPkg('internal-name', p, { crate: 'my-crate-name' })];
    expect(checkCargoShape(pkgs)).toEqual([]);
  });

  it('flags PIOT_CRATES_FEATURE_NOT_DECLARED when a configured feature is not in [features]', () => {
    const p = join(dir, 'a');
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
    const findings = checkCargoShape(pkgs);
    expect(findings.some((f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED' && /missing/.test(f.detail))).toBe(true);
  });

  it('flags PIOT_CRATES_WORKSPACE_VERSION_MISMATCH when `version.workspace = true` but no workspace ancestor declares [workspace.package].version', () => {
    // Crate sits at <root>/crates/a; no workspace Cargo.toml above it.
    const p = join(dir, 'crates', 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version.workspace = true
`,
    );
    const findings = checkCargoShape([cratesPkg('a', p)], { cwd: dir });
    expect(findings.some((f) => f.code === 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH')).toBe(true);
  });

  it('accepts `version.workspace = true` when a workspace Cargo.toml above declares [workspace.package].version', () => {
    const root = dir;
    const p = join(root, 'crates', 'a');
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
    const findings = checkCargoShape([cratesPkg('a', p)], { cwd: root });
    expect(findings.filter((f) => f.code === 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH')).toEqual([]);
  });

  it('also validates the Cargo.toml at bundle_cli.crate_path on a pypi package (PIOT_CRATES_MISSING_BIN)', () => {
    const root = dir;
    const cratePath = join(root, 'crates', 'cli');
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
    const pypiPath = join(root, 'py');
    mkdirSync(pypiPath, { recursive: true });
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: 'crates/cli', features: [], no_default_features: false },
    });
    const findings = checkCargoShape([pyPkg], { cwd: root });
    expect(findings.some((f) => f.code === 'PIOT_CRATES_MISSING_BIN' && /my-cli/.test(f.detail))).toBe(true);
  });

  it('honors an absolute bundle_cli.crate_path (skips resolve against cwd)', () => {
    // Exercises the absolute-path branch of cratePathAbs (preflight.ts:606).
    // Pass an already-absolute crate_path and pass a deliberately-wrong cwd;
    // if the absolute path is honored the Cargo.toml is found and the
    // happy-path passes; if `resolve(cwd, ...)` ran, the read would land
    // somewhere else and `CRATES_MISSING_BIN` would fire spuriously.
    const root = dir;
    const cratePath = join(root, 'crates', 'cli');
    writeCargoToml(
      cratePath,
      `[package]
name = "my-cli"
version = "0.0.0"
`,
    );
    const pypiPath = join(root, 'py');
    mkdirSync(pypiPath, { recursive: true });
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
    const findings = checkCargoShape([pyPkg], { cwd: join(root, 'does-not-exist') });
    expect(findings).toEqual([]);
  });

  it('accepts bundle_cli.bin matching either an explicit [[bin]] or the implicit `[package].name`', () => {
    const root = dir;
    const cratePath = join(root, 'crates', 'cli');
    writeCargoToml(
      cratePath,
      `[package]
name = "my-cli"
version = "0.0.0"
`,
    );
    const pypiPath = join(root, 'py');
    mkdirSync(pypiPath, { recursive: true });
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: 'crates/cli', features: [], no_default_features: false },
    });
    expect(checkCargoShape([pyPkg], { cwd: root }).filter((f) => f.code === 'PIOT_CRATES_MISSING_BIN')).toEqual([]);
  });

  it('flags PIOT_CRATES_FEATURE_NOT_DECLARED when bundle_cli.features mentions a feature the crate does not declare', () => {
    const root = dir;
    const cratePath = join(root, 'crates', 'cli');
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
    const pypiPath = join(root, 'py');
    mkdirSync(pypiPath, { recursive: true });
    const pyPkg = pkg('pypi', {
      name: 'py-lib',
      path: pypiPath,
      build: 'maturin',
      targets: ['x86_64-unknown-linux-gnu'],
      bundle_cli: { bin: 'my-cli', stage_to: 'py_lib/bin', crate_path: 'crates/cli', features: ['cli', 'undeclared'], no_default_features: false },
    });
    const findings = checkCargoShape([pyPkg], { cwd: root });
    expect(findings.some((f) => f.code === 'PIOT_CRATES_FEATURE_NOT_DECLARED' && /undeclared/.test(f.detail))).toBe(true);
  });

  it('skips a missing or malformed Cargo.toml (cargo surfaces those diagnostics)', () => {
    expect(checkCargoShape([cratesPkg('a', join(dir, 'nope'))])).toEqual([]);
    const m = join(dir, 'malformed');
    writeCargoToml(m, '[[broken\nthis = is not valid toml');
    expect(checkCargoShape([cratesPkg('a', m)])).toEqual([]);
  });

  it('skips npm packages entirely; only crates + pypi-with-bundle_cli get inspected', () => {
    expect(checkCargoShape([pkg('npm')])).toEqual([]);
  });

  it('aggregates findings across every crates package, not just the first', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeCargoToml(a, `[package]\nname = "wrong-a"\nversion = "0.0.0"\n`);
    writeCargoToml(b, `[package]\nname = "wrong-b"\nversion = "0.0.0"\n`);
    const findings = checkCargoShape([cratesPkg('a', a), cratesPkg('b', b)]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('requireCargoShape throws naming every failing package + every error code', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeCargoToml(a, `[package]\nname = "wrong-a"\nversion = "0.0.0"\n`);
    writeCargoToml(
      b,
      `[package]
name = "b"
version = "0.0.0"
[features]
default = []
`,
    );
    try {
      requireCargoShape([
        cratesPkg('a', a),
        cratesPkg('b', b, { features: ['unknown-feature'] }),
      ]);
      throw new Error('expected requireCargoShape to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('PIOT_CRATES_NAME_MISMATCH');
      expect(msg).toContain('PIOT_CRATES_FEATURE_NOT_DECLARED');
      expect(msg).toContain('wrong-a');
      expect(msg).toContain('unknown-feature');
    }
  });

  it('requireCargoShape returns silently when there are no crates / bundle_cli packages', () => {
    expect(() => requireCargoShape([pkg('npm')])).not.toThrow();
  });
});

describe('checkRepoUrlMatch / requireRepoUrlMatch — manifest URL must match GITHUB_REPOSITORY', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'piot-repo-url-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function npmPkg(name: string, path: string): Package {
    return pkg('npm', { name, path });
  }
  function cratesPkg(name: string, path: string): Package {
    return pkg('crates', { name, path });
  }
  function pypiPkg(name: string, path: string): Package {
    return pkg('pypi', { name, path });
  }
  function writePkgJson(path: string, body: unknown): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify(body), 'utf8');
  }
  function writeCargoToml(path: string, body: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'Cargo.toml'), body, 'utf8');
  }
  function writePyproject(path: string, body: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'pyproject.toml'), body, 'utf8');
  }

  it('npm: passes when repository.url (object form) parses to the same owner/repo as GITHUB_REPOSITORY', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/acme/widget.git' },
    });
    expect(
      checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('npm: passes when repository is the legacy non-empty string form and matches', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/acme/widget.git',
    });
    expect(
      checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('npm: fails when repository.url resolves to a different owner/repo (the 422 provenance bug)', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/thekevinscott/modwheel.git' },
    });
    const findings = checkRepoUrlMatch([npmPkg('a', p)], {
      githubRepository: 'thekevinscott/steervec',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      package: 'a',
      declaredOwnerRepo: 'thekevinscott/modwheel',
      expectedOwnerRepo: 'thekevinscott/steervec',
    });
  });

  it('npm: fails when repository (string form) resolves to a different owner/repo', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/repo.git',
    });
    const findings = checkRepoUrlMatch([npmPkg('a', p)], {
      githubRepository: 'acme/widget',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.declaredOwnerRepo).toBe('wrong/repo');
  });

  it('crates: passes when [package].repository matches', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "x"
license = "MIT"
repository = "https://github.com/acme/widget"
`,
    );
    expect(
      checkRepoUrlMatch([cratesPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('crates: fails when [package].repository resolves to a different owner/repo', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "x"
license = "MIT"
repository = "https://github.com/wrong/repo"
`,
    );
    const findings = checkRepoUrlMatch([cratesPkg('a', p)], {
      githubRepository: 'acme/widget',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      package: 'a',
      declaredOwnerRepo: 'wrong/repo',
      expectedOwnerRepo: 'acme/widget',
    });
  });

  it('pypi: passes when [project.urls].Repository matches', () => {
    const p = join(dir, 'a');
    writePyproject(
      p,
      `[project]
name = "a"
dynamic = ["version"]
[project.urls]
Repository = "https://github.com/acme/widget"
`,
    );
    expect(
      checkRepoUrlMatch([pypiPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('pypi: fails when [project.urls].Repository resolves to a different owner/repo', () => {
    const p = join(dir, 'a');
    writePyproject(
      p,
      `[project]
name = "a"
dynamic = ["version"]
[project.urls]
Repository = "https://github.com/wrong/repo"
`,
    );
    const findings = checkRepoUrlMatch([pypiPkg('a', p)], {
      githubRepository: 'acme/widget',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.declaredOwnerRepo).toBe('wrong/repo');
  });

  it('skips packages whose manifest does not declare a repository field (other checks own that)', () => {
    const p = join(dir, 'a');
    writePkgJson(p, { name: 'a', version: '0.0.0' });
    expect(
      checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('skips the check entirely when githubRepository is undefined (local CLI run, no GHA context)', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/repo.git',
    });
    expect(checkRepoUrlMatch([npmPkg('a', p)], {})).toEqual([]);
    expect(checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: '' })).toEqual([]);
  });

  it('parses the ssh URL form (git@github.com:owner/repo.git) to owner/repo', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'git@github.com:acme/widget.git' },
    });
    expect(
      checkRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toEqual([]);
  });

  it('parses plain https URLs without the .git suffix or with a trailing slash', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writePkgJson(a, {
      name: 'a',
      version: '0.0.0',
      repository: { type: 'git', url: 'https://github.com/acme/widget' },
    });
    writePkgJson(b, {
      name: 'b',
      version: '0.0.0',
      repository: { type: 'git', url: 'https://github.com/acme/widget/' },
    });
    expect(
      checkRepoUrlMatch(
        [npmPkg('a', a), npmPkg('b', b)],
        { githubRepository: 'acme/widget' },
      ),
    ).toEqual([]);
  });

  it('reports every failing package, not just the first', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writePkgJson(a, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/a.git',
    });
    writePkgJson(b, {
      name: 'b',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/b.git',
    });
    const findings = checkRepoUrlMatch(
      [npmPkg('a', a), npmPkg('b', b)],
      { githubRepository: 'acme/widget' },
    );
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('requireRepoUrlMatch throws with PIOT_REPO_URL_MISMATCH when any package mismatches', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/repo.git',
    });
    expect(() =>
      requireRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).toThrow(/PIOT_REPO_URL_MISMATCH/);
  });

  it('requireRepoUrlMatch error message names declared + expected owner/repo and the manifest path', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/wrong/repo.git',
    });
    try {
      requireRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' });
      throw new Error('expected requireRepoUrlMatch to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('wrong/repo');
      expect(msg).toContain('acme/widget');
      expect(msg).toContain(join(p, 'package.json'));
    }
  });

  it('requireRepoUrlMatch returns silently when every package matches', () => {
    const p = join(dir, 'a');
    writePkgJson(p, {
      name: 'a',
      version: '0.0.0',
      repository: 'git+https://github.com/acme/widget.git',
    });
    expect(() =>
      requireRepoUrlMatch([npmPkg('a', p)], { githubRepository: 'acme/widget' }),
    ).not.toThrow();
  });
});

describe('checkRepoPublic / requireRepoPublic — repo must not be private', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns null when the GitHub API reports the repo as public', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: false, visibility: 'public' })),
    );
    const finding = await checkRepoPublic({
      githubRepository: 'acme/widget',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(finding).toBeNull();
  });

  it('returns a `private` finding when the GitHub API reports the repo as private', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: true, visibility: 'private' })),
    );
    const finding = await checkRepoPublic({
      githubRepository: 'acme/widget',
      githubToken: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(finding).toMatchObject({
      githubRepository: 'acme/widget',
      reason: 'private',
    });
  });

  it('returns a `not-found-or-private` finding on a 404 (could be private or non-existent)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(404, { message: 'Not Found' })),
    );
    const finding = await checkRepoPublic({
      githubRepository: 'acme/widget',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(finding).toMatchObject({
      githubRepository: 'acme/widget',
      reason: 'not-found-or-private',
    });
  });

  it('skips entirely when githubRepository is undefined or empty', async () => {
    const fetchImpl = vi.fn();
    expect(
      await checkRepoPublic({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull();
    expect(
      await checkRepoPublic({
        githubRepository: '',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends Authorization: Bearer <token> when githubToken is supplied', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: false })),
    ) as unknown as typeof fetch;
    await checkRepoPublic({
      githubRepository: 'acme/widget',
      githubToken: 'ghs_abc123',
      fetchImpl,
    });
    const mock = fetchImpl as unknown as { mock: { calls: unknown[][] } };
    const call = mock.mock.calls[0] ?? [];
    const init = call[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    const auth = headers
      ? headers['authorization'] ?? headers['Authorization']
      : undefined;
    expect(auth).toBe('Bearer ghs_abc123');
  });

  it('hits the canonical GitHub repos endpoint with the owner/repo slug', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: false })),
    ) as unknown as typeof fetch;
    await checkRepoPublic({
      githubRepository: 'acme/widget',
      fetchImpl,
    });
    const mock = fetchImpl as unknown as { mock: { calls: unknown[][] } };
    const url = mock.mock.calls[0]?.[0] as string | undefined;
    expect(url).toBe('https://api.github.com/repos/acme/widget');
  });

  it('requireRepoPublic throws with PIOT_REPO_PRIVATE when the repo is private', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: true })),
    );
    await expect(
      requireRepoPublic({
        githubRepository: 'acme/widget',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/PIOT_REPO_PRIVATE/);
  });

  it('requireRepoPublic error message names the owner/repo and explains why private repos are rejected', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: true })),
    );
    try {
      await requireRepoPublic({
        githubRepository: 'acme/widget',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      throw new Error('expected requireRepoPublic to throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('acme/widget');
      expect(msg).toMatch(/provenance|private/i);
    }
  });

  it('requireRepoPublic returns silently when the repo is public', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(
      jsonResponse(200, { private: false })),
    );
    await expect(
      requireRepoPublic({
        githubRepository: 'acme/widget',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();
  });
});
