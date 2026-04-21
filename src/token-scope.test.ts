/**
 * Unit tests for `src/token-scope.ts` — pure scope-matching logic plus
 * the deepCheck orchestrator (with a stub InspectFn).
 */

import { describe, expect, it } from 'vitest';

import { deepCheck, publishNameFor, scopeFromInspect } from './token-scope.js';
import type { InspectResult } from './token.js';
import type { Package } from './config.js';

function mkPkg(partial: Partial<Package> & Pick<Package, 'kind' | 'name'>): Package {
  const base = {
    path: 'packages/x',
    paths: ['packages/x/**'],
    depends_on: [],
    first_version: '0.1.0',
  };
  return { ...base, ...partial } as Package;
}

describe('publishNameFor', () => {
  it('returns pkg.pypi override for pypi packages', () => {
    expect(publishNameFor(mkPkg({ kind: 'pypi', name: 'my-pkg', pypi: 'actual-on-pypi' }))).toBe(
      'actual-on-pypi',
    );
    expect(publishNameFor(mkPkg({ kind: 'pypi', name: 'my-pkg' }))).toBe('my-pkg');
  });
  it('returns pkg.npm override for npm packages', () => {
    expect(publishNameFor(mkPkg({ kind: 'npm', name: 'my-pkg', npm: '@org/published' }))).toBe(
      '@org/published',
    );
    expect(publishNameFor(mkPkg({ kind: 'npm', name: 'my-pkg' }))).toBe('my-pkg');
  });
  it('returns pkg.crate override for crates packages', () => {
    expect(publishNameFor(mkPkg({ kind: 'crates', name: 'my-pkg', crate: 'my-crate' }))).toBe(
      'my-crate',
    );
    expect(publishNameFor(mkPkg({ kind: 'crates', name: 'my-pkg' }))).toBe('my-pkg');
  });
});

describe('scopeFromInspect: pypi', () => {
  const pkg = mkPkg({ kind: 'pypi', name: 'ship-me' });

  it('full-scope token → ok, no restrictions', () => {
    const r: InspectResult = {
      registry: 'pypi',
      source_digest: 'abc',
      format: 'macaroon',
      identifier: { user: 'u-1' },
      restrictions: [],
      expired: false,
    };
    expect(scopeFromInspect(r, pkg)).toEqual({ scope: '(full-scope)', match: 'ok' });
  });

  it('matching project name → ok', () => {
    const r: InspectResult = {
      registry: 'pypi',
      source_digest: 'abc',
      format: 'macaroon',
      identifier: { user: 'u-1' },
      restrictions: [{ type: 'ProjectNames', names: ['ship-me', 'other'] }],
      expired: false,
    };
    const verdict = scopeFromInspect(r, pkg);
    expect(verdict.match).toBe('ok');
    expect(verdict.scope).toContain('ship-me');
  });

  it('non-matching project name → mismatch with detail', () => {
    const r: InspectResult = {
      registry: 'pypi',
      source_digest: 'abc',
      format: 'macaroon',
      identifier: { user: 'u-1' },
      restrictions: [{ type: 'ProjectNames', names: ['other-pkg'] }],
      expired: false,
    };
    const verdict = scopeFromInspect(r, pkg);
    expect(verdict.match).toBe('mismatch');
    expect(verdict.detail).toContain('ship-me');
    expect(verdict.detail).toContain('other-pkg');
  });

  it('respects pypi override when computing the publish name', () => {
    const withOverride = mkPkg({ kind: 'pypi', name: 'ship-me', pypi: 'under-the-hood' });
    const r: InspectResult = {
      registry: 'pypi',
      source_digest: 'abc',
      format: 'macaroon',
      identifier: { user: 'u-1' },
      restrictions: [{ type: 'ProjectNames', names: ['under-the-hood'] }],
      expired: false,
    };
    expect(scopeFromInspect(r, withOverride).match).toBe('ok');
  });

  it('dedupes restriction lists from multiple caveats', () => {
    const r: InspectResult = {
      registry: 'pypi',
      source_digest: 'abc',
      format: 'macaroon',
      identifier: { user: 'u-1' },
      restrictions: [
        { type: 'ProjectNames', names: ['ship-me'] },
        { type: 'ProjectNames', names: ['ship-me', 'other'] },
      ],
      expired: false,
    };
    const verdict = scopeFromInspect(r, pkg);
    const matches = verdict.scope.match(/ship-me/g);
    expect(matches?.length).toBe(1);
  });
});

describe('scopeFromInspect: npm', () => {
  const pkg = mkPkg({ kind: 'npm', name: '@acme/widget' });

  it('account-wide row (no grants) → ok', () => {
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'granular',
      username: 'alice',
      scope_row: {
        readonly: false,
        automation: false,
        packages: null,
        scopes: null,
        orgs: null,
        expires_at: null,
        cidr_whitelist: null,
        created: null,
      },
    };
    expect(scopeFromInspect(r, pkg).match).toBe('ok');
  });

  it('explicit package grant → ok', () => {
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'granular',
      username: 'alice',
      scope_row: {
        readonly: false,
        automation: false,
        packages: ['@acme/widget'],
        scopes: null,
        orgs: null,
        expires_at: null,
        cidr_whitelist: null,
        created: null,
      },
    };
    expect(scopeFromInspect(r, pkg).match).toBe('ok');
  });

  it('scope grant that contains the package → ok', () => {
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'granular',
      username: 'alice',
      scope_row: {
        readonly: false,
        automation: false,
        packages: null,
        scopes: ['@acme'],
        orgs: null,
        expires_at: null,
        cidr_whitelist: null,
        created: null,
      },
    };
    expect(scopeFromInspect(r, pkg).match).toBe('ok');
  });

  it('non-matching package allowlist → mismatch', () => {
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'granular',
      username: 'alice',
      scope_row: {
        readonly: false,
        automation: false,
        packages: ['@other/thing'],
        scopes: null,
        orgs: null,
        expires_at: null,
        cidr_whitelist: null,
        created: null,
      },
    };
    const verdict = scopeFromInspect(r, pkg);
    expect(verdict.match).toBe('mismatch');
    expect(verdict.detail).toContain('@acme/widget');
  });

  it('legacy token (no scope row) → ok with informational scope', () => {
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'legacy',
      username: 'alice',
      scope_row: null,
    };
    const verdict = scopeFromInspect(r, pkg);
    expect(verdict.match).toBe('ok');
    expect(verdict.scope).toContain('legacy');
  });

  it('org-only grant against an unscoped package name → mismatch', () => {
    const unscoped = mkPkg({ kind: 'npm', name: 'just-a-tool' });
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'granular',
      username: 'alice',
      scope_row: {
        readonly: false,
        automation: false,
        packages: null,
        scopes: null,
        orgs: ['acme'],
        expires_at: null,
        cidr_whitelist: null,
        created: null,
      },
    };
    expect(scopeFromInspect(r, unscoped).match).toBe('mismatch');
  });

  it('normalizes bare scope name to @-prefix when matching', () => {
    const r: InspectResult = {
      registry: 'npm',
      source_digest: 'abc',
      format: 'granular',
      username: 'alice',
      scope_row: {
        readonly: false,
        automation: false,
        packages: null,
        scopes: ['acme'],
        orgs: null,
        expires_at: null,
        cidr_whitelist: null,
        created: null,
      },
    };
    expect(scopeFromInspect(r, pkg).match).toBe('ok');
  });
});

describe('scopeFromInspect: crates', () => {
  const pkg = mkPkg({ kind: 'crates', name: 'my-crate' });
  it('always returns unknown because the bearer row is not identifiable', () => {
    const r: InspectResult = {
      registry: 'crates',
      source_digest: 'abc',
      username: 'alice',
      account_tokens: [
        { name: 'ci', endpoint_scopes: ['publish-update'], crate_scopes: null, expired_at: null },
      ],
      bearer_row: null,
      note: 'crates.io does not expose which row corresponds to the bearer.',
    };
    expect(scopeFromInspect(r, pkg)).toMatchObject({ match: 'unknown' });
  });
});

describe('scopeFromInspect: error pass-through', () => {
  const pkg = mkPkg({ kind: 'pypi', name: 'whatever' });
  it('surfaces inspect errors as match=error', () => {
    const r: InspectResult = {
      registry: 'pypi',
      source_digest: 'abc',
      error: 'invalid base64 in token body',
    };
    expect(scopeFromInspect(r, pkg)).toMatchObject({
      match: 'error',
      detail: 'invalid base64 in token body',
    });
  });
});

describe('deepCheck', () => {
  it('calls inspect per-package and emits one row each', async () => {
    const calls: Array<{ token: string; registry: string | undefined }> = [];
    const rows = await deepCheck({
      packages: [
        mkPkg({ kind: 'pypi', name: 'p1' }),
        mkPkg({ kind: 'npm', name: 'n1' }),
      ],
      envVarForPackage: new Map([
        ['p1', 'PYPI_API_TOKEN'],
        ['n1', 'NPM_TOKEN'],
      ]),
      env: {
        PYPI_API_TOKEN: 'pypi-...',
        NPM_TOKEN: 'npm_...',
      },
      inspect: (opts) => {
        calls.push({ token: opts.token, registry: opts.registry });
        if (opts.registry === 'pypi') {
          return Promise.resolve<InspectResult>({
            registry: 'pypi',
            source_digest: 'x',
            format: 'macaroon',
            identifier: {},
            restrictions: [],
            expired: false,
          });
        }
        return Promise.resolve<InspectResult>({
          registry: 'npm',
          source_digest: 'x',
          format: 'granular',
          username: 'alice',
          scope_row: null,
        });
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.registry).toBe('pypi');
    expect(calls[1]!.registry).toBe('npm');
    expect(rows.map((r) => r.match)).toEqual(['ok', 'ok']);
  });

  it('emits match=error with detail when the env var has no value', async () => {
    const rows = await deepCheck({
      packages: [mkPkg({ kind: 'pypi', name: 'p1' })],
      envVarForPackage: new Map([['p1', 'PYPI_API_TOKEN']]),
      env: {},
      inspect: () => Promise.reject(new Error('should not be called')),
    });
    expect(rows[0]!.match).toBe('error');
    expect(rows[0]!.detail).toContain('PYPI_API_TOKEN');
  });

  it('emits match=error when no env var is mapped at all', async () => {
    const rows = await deepCheck({
      packages: [mkPkg({ kind: 'pypi', name: 'p1' })],
      envVarForPackage: new Map(),
      env: {},
      inspect: () => Promise.reject(new Error('should not be called')),
    });
    expect(rows[0]!.match).toBe('error');
    expect(rows[0]!.detail).toContain('unknown');
  });
});
