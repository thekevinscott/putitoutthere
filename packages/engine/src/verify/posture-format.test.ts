/**
 * `formatVerifyRow` (#414): the single-line, non-`--json` render of one
 * `verify` row. Pins the mark and the human note for each of the four
 * postures, plus the `—` version fallback.
 */

import { describe, expect, it } from 'vitest';

import type { VerifyRow } from './posture-types.js';
import { formatVerifyRow } from './posture-format.js';

function row(overrides: Partial<VerifyRow>): VerifyRow {
  return { package: 'demo', kind: 'crates', version: '1.0.0', posture: 'oidc', ...overrides };
}

describe('formatVerifyRow', () => {
  it('renders ✓ and the trusted-publisher note for oidc', () => {
    expect(formatVerifyRow(row({ posture: 'oidc' }))).toBe(
      'demo  1.0.0  ✓ oidc  trusted publisher (safe to drop the token)',
    );
  });

  it('renders ⚠ and the token-dependent note for token', () => {
    expect(formatVerifyRow(row({ posture: 'token' }))).toBe(
      'demo  1.0.0  ⚠ token  token-dependent — no trusted publisher',
    );
  });

  it('renders ? and "never published" for unpublished, with — for a null version', () => {
    expect(formatVerifyRow(row({ posture: 'unpublished', version: null }))).toBe(
      'demo  —  ? unpublished  never published',
    );
  });

  it('renders ? and "registry unreachable" for unreachable', () => {
    expect(formatVerifyRow(row({ posture: 'unreachable', version: null }))).toBe(
      'demo  —  ? unreachable  registry unreachable',
    );
  });
});
