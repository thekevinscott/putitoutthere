import { describe, expect, it } from 'vitest';

import { parseEvidenceClause } from './parse-evidence.js';

describe('parseEvidenceClause', () => {
  it('parses a verified-by clause', () => {
    expect(parseEvidenceClause('- Fixed: x (verified by: e2e/js-vanilla)')).toEqual({
      kind: 'verified',
      value: 'e2e/js-vanilla',
    });
  });

  it('parses a no-fixture clause', () => {
    expect(parseEvidenceClause('- Changed: x (no fixture: pure refactor)')).toEqual({
      kind: 'no-fixture',
      value: 'pure refactor',
    });
  });

  it('keeps a comma-separated citation list as one value', () => {
    expect(parseEvidenceClause('- x (verified by: e2e/a, unit/b)')).toEqual({
      kind: 'verified',
      value: 'e2e/a, unit/b',
    });
  });

  it('accepts no space after the colon', () => {
    expect(parseEvidenceClause('- x (verified by:e2e/a)')).toEqual({ kind: 'verified', value: 'e2e/a' });
  });

  it('is case-insensitive on the clause keyword', () => {
    expect(parseEvidenceClause('- x (VERIFIED BY: e2e/a)')).toEqual({ kind: 'verified', value: 'e2e/a' });
  });

  it('preserves the <reason> placeholder as the value', () => {
    expect(parseEvidenceClause('- x (no fixture: <reason>)')).toEqual({ kind: 'no-fixture', value: '<reason>' });
  });

  it('treats a whitespace-only value as empty (but present)', () => {
    expect(parseEvidenceClause('- x (verified by: )')).toEqual({ kind: 'verified', value: '' });
  });

  it('returns null when the keyword has no value at all', () => {
    expect(parseEvidenceClause('- x (verified by:)')).toBeNull();
  });

  it('returns null when a no-fixture keyword has no value at all', () => {
    expect(parseEvidenceClause('- x (no fixture:)')).toBeNull();
  });

  it('returns null when there is no trailing clause', () => {
    expect(parseEvidenceClause('- Fixed: something with no citation')).toBeNull();
  });

  it('returns null for an unrelated trailing parenthetical', () => {
    expect(parseEvidenceClause('- Fixed: x (see issue 12)')).toBeNull();
  });

  it('returns null when text follows the closing paren', () => {
    expect(parseEvidenceClause('- x (verified by: e2e/a) and more')).toBeNull();
  });

  it('tolerates trailing whitespace after the closing paren', () => {
    expect(parseEvidenceClause('- x (verified by: e2e/a)   ')).toEqual({ kind: 'verified', value: 'e2e/a' });
  });

  it('uses the last parenthetical when several are present', () => {
    expect(parseEvidenceClause('- x (aside) (verified by: e2e/a)')).toEqual({ kind: 'verified', value: 'e2e/a' });
  });

  it('returns null when the value would contain a closing paren', () => {
    expect(parseEvidenceClause('- x (verified by: e2e/a) leftover)')).toBeNull();
  });

  it('returns null when a closing paren has no opening paren', () => {
    expect(parseEvidenceClause('- x verified by: e2e/a)')).toBeNull();
  });

  it('returns null when a clause-shaped tail is not closed by a paren', () => {
    // Without the trailing-`)` guard, this would be sliced into a bogus clause.
    expect(parseEvidenceClause('- x (verified by: e2e/a')).toBeNull();
  });

  it('returns null for a clause-shaped string with no opening paren at all', () => {
    // Exercises the open === -1 guard: the whole string ends with `)` but has
    // no `(`, so there is no clause even though it reads like one.
    expect(parseEvidenceClause('verified by: e2e/a)')).toBeNull();
  });
});
