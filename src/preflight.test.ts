/**
 * Pre-flight auth check tests. Per plan.md §16.3.
 *
 * Issue #14.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAuth, requireAuth, type AuthStatus } from './preflight.js';
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
