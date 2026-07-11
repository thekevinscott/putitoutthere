/**
 * Single-line render of one `verify` row for the CLI's non-`--json`
 * output.
 *
 * Issue #414.
 */

import type { VerifyRow } from './posture-types.js';

export function formatVerifyRow(row: VerifyRow): string {
  const mark = row.posture === 'oidc' ? '✓' : row.posture === 'token' ? '⚠' : '?';
  const note =
    row.posture === 'oidc'
      ? 'trusted publisher (safe to drop the token)'
      : row.posture === 'token'
        ? 'token-dependent — no trusted publisher'
        : row.posture === 'unpublished'
          ? 'never published'
          : 'registry unreachable';
  return `${row.package}  ${row.version ?? '—'}  ${mark} ${row.posture}  ${note}`;
}
