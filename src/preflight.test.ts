/**
 * Pre-flight check tests. Auth (§16.3) + npm provenance metadata (#280).
 *
 * Issue #14, #280.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkAuth,
  checkCratesMetadata,
  checkProvenanceMetadata,
  requireAuth,
  requireCratesMetadata,
  requireProvenanceMetadata,
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

  function writeCargoToml(path: string, body: string): void {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'Cargo.toml'), body, 'utf8');
  }

  it('passes when description + license are both present', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "A test crate."
license = "MIT"
`,
    );
    expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
    expect(() => requireCratesMetadata([cratesPkg('a', p)])).not.toThrow();
  });

  it('accepts license-file in place of license', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "A test crate."
license-file = "LICENSE"
`,
    );
    expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
  });

  it('reports missing description', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
license = "MIT"
`,
    );
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'a', missing: ['description'] });
  });

  it('reports missing license when neither license nor license-file is set', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "A test crate."
`,
    );
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'a', missing: ['license'] });
  });

  it('reports both fields together when both are missing', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
`,
    );
    const findings = checkCratesMetadata([cratesPkg('a', p)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.missing).toEqual(['description', 'license']);
  });

  it('treats whitespace-only fields as empty', () => {
    const p = join(dir, 'a');
    writeCargoToml(
      p,
      `[package]
name = "a"
version = "0.0.0"
description = "   "
license = ""
`,
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
    writeCargoToml(p, '[[broken\nthis = is not valid toml');
    expect(checkCratesMetadata([cratesPkg('a', p)])).toEqual([]);
  });

  it('skips non-crates packages entirely', () => {
    expect(checkCratesMetadata([pkg('npm'), pkg('pypi')])).toEqual([]);
  });

  it('reports every failing crates package, not just the first', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeCargoToml(a, `[package]\nname = "a"\nversion = "0.0.0"\n`);
    writeCargoToml(b, `[package]\nname = "b"\nversion = "0.0.0"\n`);
    const findings = checkCratesMetadata([cratesPkg('a', a), cratesPkg('b', b)]);
    expect(findings.map((f) => f.package).sort()).toEqual(['a', 'b']);
  });

  it('throws with PIOT_CRATES_MISSING_METADATA when any crates package fails', () => {
    const p = join(dir, 'a');
    writeCargoToml(p, `[package]\nname = "a"\nversion = "0.0.0"\n`);
    expect(() => requireCratesMetadata([cratesPkg('a', p)])).toThrow(
      /PIOT_CRATES_MISSING_METADATA/,
    );
  });

  it('error message names every failing package, its Cargo.toml path, and the missing fields', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    writeCargoToml(a, `[package]\nname = "a"\nversion = "0.0.0"\nlicense = "MIT"\n`);
    writeCargoToml(b, `[package]\nname = "b"\nversion = "0.0.0"\ndescription = "x"\n`);
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
    writeCargoToml(p, `[package]\nname = "a"\nversion = "0.0.0"\n`);
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
});
