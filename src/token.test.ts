/**
 * Unit tests for `src/token.ts`.
 *
 * Covers detection + PyPI macaroon decoding. npm and crates.io are
 * placeholders (#108 / #109) and only get shape assertions here.
 */

import { describe, expect, it } from 'vitest';
import { detectRegistry, inspect, isError } from './token.js';
import type { PypiInspectResult } from './token.js';

/**
 * Build a synthetic PyPI token whose base64 payload contains the given
 * JSON blobs in order. The real macaroon envelope surrounds these
 * blobs with binary header bytes; our JSON-scanner ignores them, so
 * inserting arbitrary binary separators is representative.
 */
function buildPypiToken(identifier: object, caveats: object[]): string {
  const parts = [
    Buffer.from([0x02]), // v2 version byte
    Buffer.from(JSON.stringify(identifier), 'utf8'),
  ];
  for (const c of caveats) {
    parts.push(Buffer.from([0x00, 0x01])); // arbitrary separator bytes
    parts.push(Buffer.from(JSON.stringify(c), 'utf8'));
  }
  parts.push(Buffer.from([0x04, 0x00])); // fake signature marker
  return 'pypi-' + Buffer.concat(parts).toString('base64');
}

function asPypi(r: ReturnType<typeof inspect>): PypiInspectResult {
  if (isError(r)) throw new Error(`expected success; got error: ${r.error}`);
  if (r.registry !== 'pypi') throw new Error(`expected pypi; got ${r.registry}`);
  return r;
}

describe('detectRegistry', () => {
  it('detects pypi tokens by prefix', () => {
    expect(detectRegistry('pypi-deadbeef')).toBe('pypi');
  });

  it('detects npm tokens by prefix', () => {
    expect(detectRegistry('npm_abc123')).toBe('npm');
  });

  it('falls back to crates for opaque tokens', () => {
    expect(detectRegistry('ci0abcdef0123456789')).toBe('crates');
  });
});

describe('inspect — PyPI', () => {
  it('decodes a user-scoped token', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [],
    );
    const r = asPypi(inspect({ token }));
    expect(r.format).toBe('macaroon');
    expect(r.identifier).toEqual({ version: 1, permissions: 'user', user: 'u-abc' });
    expect(r.restrictions).toEqual([]);
    expect(r.expired).toBe(false);
    expect(r.source_digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('decodes a v2-style project-names caveat', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ version: 1, projects: ['pkg-a', 'pkg-b'] }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectNames', names: ['pkg-a', 'pkg-b'] },
    ]);
  });

  it('decodes a legacy v1-shape permissions caveat', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ permissions: { projects: ['legacy-pkg'] }, version: 1 }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectNames', names: ['legacy-pkg'] },
    ]);
  });

  it('decodes a project-ids caveat', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ version: 2, project_ids: ['id-1', 'id-2'] }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectIDs', ids: ['id-1', 'id-2'] },
    ]);
  });

  it('decodes a date restriction (nbf/exp shape)', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ nbf: 1000, exp: 2000 }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'Date', not_before: 1000, not_after: 2000 },
    ]);
  });

  it('decodes a date restriction (not_before/not_after shape)', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ not_before: 500, not_after: 1500 }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'Date', not_before: 500, not_after: 1500 },
    ]);
  });

  it('marks expired=true when not_after is in the past', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ not_after: 1 }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.expired).toBe(true);
  });

  it('marks expired=false for a far-future expiry', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ not_after: 9_999_999_999 }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.expired).toBe(false);
  });

  it('preserves unknown caveat shapes as Unknown', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [{ something_new: 'whatever', count: 3 }],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'Unknown', raw: { something_new: 'whatever', count: 3 } },
    ]);
  });

  it('decodes multiple caveats in order', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc' },
      [
        { version: 1, projects: ['a'] },
        { not_before: 0, not_after: 9_999_999_999 },
      ],
    );
    const r = asPypi(inspect({ token }));
    expect(r.restrictions).toEqual([
      { type: 'ProjectNames', names: ['a'] },
      { type: 'Date', not_before: 0, not_after: 9_999_999_999 },
    ]);
  });

  it('tolerates JSON containing braces inside strings', () => {
    const token = buildPypiToken(
      { version: 1, permissions: 'user', user: 'u-abc', note: 'has { and } in it' },
      [],
    );
    const r = asPypi(inspect({ token }));
    expect((r.identifier as Record<string, unknown>).note).toBe('has { and } in it');
  });

  it('errors on a token missing the pypi- prefix when --registry=pypi', () => {
    const r = inspect({ token: 'not-pypi-token', registry: 'pypi' });
    expect(isError(r) ? r.error : '').toMatch(/pypi-/);
  });

  it('errors on base64 that decodes to no JSON', () => {
    const token = 'pypi-' + Buffer.from('no json here just bytes').toString('base64');
    const r = inspect({ token });
    expect(isError(r)).toBe(true);
  });

  it('errors on a bare "pypi-" token with empty body', () => {
    const r = inspect({ token: 'pypi-' });
    expect(isError(r) ? r.error : '').toMatch(/base64/);
  });

  it('decodes an unpadded base64 body', () => {
    // Drop trailing '=' padding — some PyPI serializers have emitted
    // both padded and unpadded bodies historically.
    const padded = buildPypiToken({ version: 1, permissions: 'user', user: 'u-abc' }, []);
    const stripped = 'pypi-' + padded.slice('pypi-'.length).replace(/=+$/, '');
    const r = asPypi(inspect({ token: stripped }));
    expect((r.identifier as Record<string, unknown>).user).toBe('u-abc');
  });

  it('skips unmatched braces and invalid-JSON blocks before real macaroon JSON', () => {
    // Mix of hazards before the real identifier:
    //   - a lone "{" that never closes -> findMatchingBrace returns -1
    //   - a "{\x00}" block that balances but is not valid JSON -> JSON.parse catch path
    //   - the real identifier carries an escaped quote in a string value -> backslash-escape
    //     state in findMatchingBrace
    const parts = [
      Buffer.from([0x02]),
      Buffer.from('{ no close here'),
      Buffer.from([0x7b, 0x00, 0x7d]), // "{\x00}"
      Buffer.from(JSON.stringify({ version: 1, permissions: 'user', note: 'a "b" c' })),
      Buffer.from([0x04, 0x00]),
    ];
    const token = 'pypi-' + Buffer.concat(parts).toString('base64');
    const r = asPypi(inspect({ token }));
    expect(r.identifier).toEqual({ version: 1, permissions: 'user', note: 'a "b" c' });
  });

  it('computes a stable sha256 digest prefix', () => {
    const token = buildPypiToken({ version: 1 }, []);
    const r1 = inspect({ token });
    const r2 = inspect({ token });
    expect(r1.source_digest).toBe(r2.source_digest);
  });
});

describe('inspect — npm placeholder', () => {
  it('returns pending status for npm_ prefix', () => {
    const r = inspect({ token: 'npm_abcdef0123' });
    if (isError(r) || r.registry !== 'npm') throw new Error('expected npm');
    expect(r.format).toBe('granular');
    expect(r.status).toBe('pending');
  });

  it('marks format=unknown when an opaque token is routed to npm via override', () => {
    const r = inspect({ token: 'ci0deadbeef', registry: 'npm' });
    if (isError(r) || r.registry !== 'npm') throw new Error('expected npm');
    expect(r.format).toBe('unknown');
  });
});

describe('inspect — crates placeholder', () => {
  it('returns pending status when format is unrecognized', () => {
    const r = inspect({ token: 'ci0deadbeefcafe' });
    if (isError(r) || r.registry !== 'crates') throw new Error('expected crates');
    expect(r.status).toBe('pending');
  });

  it('honors an explicit --registry=crates override', () => {
    const r = inspect({ token: 'npm_abc', registry: 'crates' });
    expect(r.registry).toBe('crates');
  });
});
