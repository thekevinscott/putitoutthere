import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireAuth } from './require-auth.js';
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
  for (const k of AUTH_VARS) {delete process.env[k];}
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_BAK)) {delete process.env[k];}
  }
  Object.assign(process.env, ENV_BAK);
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
