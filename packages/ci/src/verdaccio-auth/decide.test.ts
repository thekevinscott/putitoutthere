/**
 * Decision matrix for the Verdaccio-auth harness (#453), extracted from the
 * "Configure Verdaccio auth (first-publish)" bash. Pins the token-validity
 * gate, the exact `.npmrc` contents written per npm package, and every emitted
 * line (`::error::`, `::add-mask::`, `Wrote ...`). Pure. Assertions are exact.
 */

import { describe, expect, it } from 'vitest';

import { decideVerdaccioAuth } from './decide.js';

const matrix = JSON.stringify([
  { kind: 'npm', path: 'packages/a' },
  { kind: 'npm', path: 'packages/b' },
  { kind: 'crates', path: 'crate' },
]);

describe('decideVerdaccioAuth: invalid token', () => {
  it('fails, echoing the raw response, when the token is empty', () => {
    expect(decideVerdaccioAuth({ matrix, token: '', response: '{"token":""}' })).toEqual({
      exitCode: 1,
      lines: ['::error::Verdaccio user-create did not return a token. Response: {"token":""}'],
      files: [],
    });
  });

  it('fails when the parsed token is the literal string "null" (key absent)', () => {
    expect(decideVerdaccioAuth({ matrix, token: 'null', response: '{}' })).toEqual({
      exitCode: 1,
      lines: ['::error::Verdaccio user-create did not return a token. Response: {}'],
      files: [],
    });
  });
});

describe('decideVerdaccioAuth: valid token', () => {
  it('masks the token and writes a per-package .npmrc with registry, auth, always-auth', () => {
    const result = decideVerdaccioAuth({ matrix, token: 'tok-123', response: '{"token":"tok-123"}' });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      '::add-mask::tok-123',
      'Wrote fixture-tree/packages/a/.npmrc',
      'Wrote fixture-tree/packages/b/.npmrc',
    ]);
    expect(result.files).toEqual([
      {
        path: 'fixture-tree/packages/a/.npmrc',
        content: 'registry=http://localhost:4873/\n//localhost:4873/:_authToken=tok-123\nalways-auth=true\n',
      },
      {
        path: 'fixture-tree/packages/b/.npmrc',
        content: 'registry=http://localhost:4873/\n//localhost:4873/:_authToken=tok-123\nalways-auth=true\n',
      },
    ]);
  });

  it('emits only the mask line when the matrix has no npm rows', () => {
    const result = decideVerdaccioAuth({ matrix: JSON.stringify([{ kind: 'crates', path: 'c' }]), token: 't', response: '{"token":"t"}' });
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(['::add-mask::t']);
    expect(result.files).toEqual([]);
  });
});
