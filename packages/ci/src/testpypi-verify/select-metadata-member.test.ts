/**
 * Pins `selectMetadataMember`: exactly one `.dist-info/METADATA` member is
 * required; zero or several yield the exact `expected one METADATA file …`
 * error with the repr list.
 */

import { describe, expect, it } from 'vitest';

import { selectMetadataMember } from './select-metadata-member.js';

describe('selectMetadataMember', () => {
  it('selects the single METADATA member', () => {
    expect(
      selectMetadataMember(['foo-1.0.dist-info/RECORD', 'foo-1.0.dist-info/METADATA', 'foo-1.0.dist-info/WHEEL'], 'foo.whl'),
    ).toEqual({ member: 'foo-1.0.dist-info/METADATA' });
  });

  it('errors with [] when no METADATA member exists', () => {
    expect(selectMetadataMember(['foo-1.0.dist-info/RECORD'], 'foo.whl')).toEqual({
      errorLine: 'expected one METADATA file in foo.whl, found []',
    });
  });

  it('errors with the repr list when several METADATA members exist', () => {
    expect(selectMetadataMember(['a.dist-info/METADATA', 'b.dist-info/METADATA'], 'foo.whl')).toEqual({
      errorLine: "expected one METADATA file in foo.whl, found ['a.dist-info/METADATA', 'b.dist-info/METADATA']",
    });
  });
});
