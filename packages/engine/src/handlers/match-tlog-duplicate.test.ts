import { describe, expect, it } from 'vitest';

import { matchTlogDuplicate } from './match-tlog-duplicate.js';

describe('matchTlogDuplicate', () => {
  it('returns the stderr verbatim on npm\'s TLOG_CREATE_ENTRY_ERROR code', () => {
    const stderr = 'npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry - (409) ...';
    expect(matchTlogDuplicate(stderr)).toBe(stderr);
  });

  it('returns the stderr verbatim on the Rekor "equivalent entry already exists" prose even without the code', () => {
    const stderr =
      'npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186e8c5677a';
    expect(matchTlogDuplicate(stderr)).toBe(stderr);
  });

  it('returns null on an unrelated bare 409 (not the tlog dedupe shape)', () => {
    expect(matchTlogDuplicate('npm error code E409\nnpm error 409 Conflict')).toBeNull();
  });

  // Empty string flows past the `stderr !== undefined` guard into the regex,
  // which cannot match it, so the result is still null. This pins the guard
  // against a `&&`->`||` rewrite that would return '' verbatim for empty
  // stderr.
  it('returns null on empty string', () => {
    expect(matchTlogDuplicate('')).toBeNull();
  });

  it('returns null on undefined', () => {
    expect(matchTlogDuplicate(undefined)).toBeNull();
  });
});
