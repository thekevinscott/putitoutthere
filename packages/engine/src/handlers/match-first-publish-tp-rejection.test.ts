import { describe, expect, it } from 'vitest';

import { matchFirstPublishTpRejection } from './match-first-publish-tp-rejection.js';

describe('matchFirstPublishTpRejection (#284)', () => {
  it('returns the stderr verbatim on the canonical 404 + "crate does not exist" stderr', () => {
    const stderr = [
      'error: failed to publish to registry at https://crates.io',
      'Caused by:',
      '  the remote server responded with an error (status 404 Not Found): Crate `demo-crate` does not exist or you do not have permission to publish to it.',
    ].join('\n');
    expect(matchFirstPublishTpRejection(stderr)).toBe(stderr);
  });

  it('returns the stderr verbatim when the 404 line and a "trusted publish" mention co-occur', () => {
    const stderr = [
      'status 404 Not Found',
      'Trusted publishing requires the crate to already exist.',
    ].join('\n');
    expect(matchFirstPublishTpRejection(stderr)).toBe(stderr);
  });

  it('returns null when only one anchor is present (404 without the prose)', () => {
    expect(
      matchFirstPublishTpRejection(
        'status 404 Not Found\nsome unrelated error about a missing index file',
      ),
    ).toBeNull();
  });

  it('returns null when only one anchor is present (prose without the 404)', () => {
    expect(
      matchFirstPublishTpRejection(
        'crate `demo-crate` does not exist — but this is a dependency error, not a 4xx',
      ),
    ).toBeNull();
  });

  it('returns null on an unrelated 429 rate-limit stderr', () => {
    expect(
      matchFirstPublishTpRejection(
        'status 429 Too Many Requests\nYou have published too many versions of this crate in the last 24 hours',
      ),
    ).toBeNull();
  });

  it('returns null on an undefined stderr (defensive)', () => {
    expect(matchFirstPublishTpRejection(undefined)).toBeNull();
  });

  // Empty string flows past the `stderr !== undefined` guard; no anchor
  // matches, so the result is null. Pins the guard against a `&&`->`||`
  // rewrite that would return '' verbatim for empty stderr.
  it('returns null on empty string', () => {
    expect(matchFirstPublishTpRejection('')).toBeNull();
  });

  // Whitespace near-misses: each anchor's inter-token gap requires one-or-more
  // whitespace (`\s+`). Feeding a matching shape with *two* spaces at a gap
  // proves the regex needs `\s+`, not a single `\s` — collapsing any `\s+` to
  // `\s` then fails to match multi-space output and the predicate returns null.
  it('matches multi-space "status  404" (pins status anchor as \\s+)', () => {
    const stderr = 'the remote server responded with an error (status  404 Not Found): Crate `demo` does not exist';
    expect(matchFirstPublishTpRejection(stderr)).toBe(stderr);
  });

  it('matches multi-space "crate does not exist" prose (pins each prose gap as \\s+)', () => {
    const stderr = 'status 404 Not Found: Crate  `demo`  does  not  exist or you do not have permission';
    expect(matchFirstPublishTpRejection(stderr)).toBe(stderr);
  });

  it('matches multi-space "trusted  publishing" mention (pins trusted anchor as \\s+)', () => {
    const stderr = 'status 404 Not Found\nTrusted  publishing requires the crate to already exist.';
    expect(matchFirstPublishTpRejection(stderr)).toBe(stderr);
  });
});
