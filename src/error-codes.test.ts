/**
 * Error-code module tests.
 *
 * Phase 1 / Idea 4. The codes are a stable vocabulary that user-facing
 * error messages and `::error::` annotations will tag. Foreign agents
 * debugging a failed publish from the outside can fingerprint on the
 * code instead of free-form prose; the docs site can deep-link
 * `auth.html?code=PIOT_…` to a code-specific recipe.
 */

import { describe, expect, it } from 'vitest';

import { ALL_ERROR_CODES, ErrorCodes, type ErrorCode } from './error-codes.js';

describe('error-codes', () => {
  it('every code starts with PIOT_', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(code).toMatch(/^PIOT_[A-Z0-9_]+$/);
    }
  });

  it('codes are unique', () => {
    const seen = new Set<string>();
    for (const code of ALL_ERROR_CODES) {
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });

  it('ErrorCodes object value matches the corresponding ALL_ERROR_CODES entry', () => {
    // Guard against drift between the named constant export and the
    // iterable list — Phase 3/Idea 6 walks ALL_ERROR_CODES to render
    // a markdown reference table; a missing entry there would silently
    // omit a code from public docs.
    const fromObject = new Set<string>(Object.values(ErrorCodes));
    const fromList = new Set<string>(ALL_ERROR_CODES);
    expect(fromObject).toEqual(fromList);
  });

  it('exposes the AUTH_NO_TOKEN code surfaced by registry handlers', () => {
    expect(ErrorCodes.AUTH_NO_TOKEN).toBe('PIOT_AUTH_NO_TOKEN');
  });

  it('exposes the PUBLISH_EMPTY_PLAN code thrown when publish runs with an empty matrix', () => {
    expect(ErrorCodes.PUBLISH_EMPTY_PLAN).toBe('PIOT_PUBLISH_EMPTY_PLAN');
  });

  it('exposes every pypi-shape preflight code surfaced by requirePyprojectShape (#301)', () => {
    expect(ErrorCodes.PYPI_NAME_MISMATCH).toBe('PIOT_PYPI_NAME_MISMATCH');
    expect(ErrorCodes.PYPI_BUILD_BACKEND_MISMATCH).toBe('PIOT_PYPI_BUILD_BACKEND_MISMATCH');
    expect(ErrorCodes.PYPI_DYNAMIC_VERSION_NO_BACKEND).toBe('PIOT_PYPI_DYNAMIC_VERSION_NO_BACKEND');
    expect(ErrorCodes.PYPI_MATURIN_INCLUDE_MISSING).toBe('PIOT_PYPI_MATURIN_INCLUDE_MISSING');
  });

  it('exposes every cargo-shape preflight code surfaced by requireCargoShape (#301)', () => {
    expect(ErrorCodes.CRATES_NAME_MISMATCH).toBe('PIOT_CRATES_NAME_MISMATCH');
    expect(ErrorCodes.CRATES_MISSING_BIN).toBe('PIOT_CRATES_MISSING_BIN');
    expect(ErrorCodes.CRATES_FEATURE_NOT_DECLARED).toBe('PIOT_CRATES_FEATURE_NOT_DECLARED');
    expect(ErrorCodes.CRATES_WORKSPACE_VERSION_MISMATCH).toBe('PIOT_CRATES_WORKSPACE_VERSION_MISMATCH');
  });

  it('ErrorCode type alias resolves to the union of literal strings', () => {
    // Compile-time assertion that every value passes the type check.
    const sample: ErrorCode = ErrorCodes.AUTH_NO_TOKEN;
    expect(sample).toBe('PIOT_AUTH_NO_TOKEN');
  });
});
