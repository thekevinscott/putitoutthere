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

  it('returns null on undefined / empty', () => {
    expect(matchTlogDuplicate(undefined)).toBeNull();
    expect(matchTlogDuplicate('')).toBeNull();
  });
});
