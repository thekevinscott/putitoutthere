import { describe, expect, it } from 'vitest';

import { parseEvidenceClause } from './parse-evidence-clause.js';

describe('parseEvidenceClause', () => {
  it('parses a trailing `(verified by: ...)` clause, lowercasing the kind', () => {
    expect(
      parseEvidenceClause('- Fixed: thing. (verified by: e2e/x, integration/y)'),
    ).toEqual({ kind: 'verified by', value: 'e2e/x, integration/y' });
  });

  it('parses a trailing `(no fixture: ...)` clause', () => {
    expect(parseEvidenceClause('- Changed: refactor. (no fixture: pure refactor)')).toEqual({
      kind: 'no fixture',
      value: 'pure refactor',
    });
  });

  it('trims the captured value', () => {
    expect(parseEvidenceClause('- x (verified by:   e2e/x   )')?.value).toBe('e2e/x');
  });

  it('matches a whitespace-only reason (value trims to empty)', () => {
    expect(parseEvidenceClause('- x (no fixture: )')).toEqual({ kind: 'no fixture', value: '' });
  });

  it('is case-insensitive on the clause keyword', () => {
    expect(parseEvidenceClause('- x (Verified By: e2e/x)')?.kind).toBe('verified by');
  });

  it('returns null when there is no trailing clause', () => {
    expect(parseEvidenceClause('- Fixed: no clause here')).toBeNull();
  });

  it('returns null when the clause is not at the end of the line', () => {
    expect(parseEvidenceClause('- x (verified by: e2e/x) trailing words')).toBeNull();
  });
});
