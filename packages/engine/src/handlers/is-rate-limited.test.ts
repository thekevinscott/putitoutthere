import { describe, expect, it } from 'vitest';

import { isRateLimited } from './is-rate-limited.js';

describe('isRateLimited', () => {
  it("matches cargo's crates.io 429 stderr", () => {
    const stderr = [
      'error: failed to publish to registry at https://crates.io',
      '',
      'Caused by:',
      '  the remote server responded with an error (status 429 Too Many Requests): You have published too many versions of this crate in the last 24 hours',
    ].join('\n');
    expect(isRateLimited(stderr)).toBe(true);
  });

  it('is false for missing or empty stderr', () => {
    expect(isRateLimited(undefined)).toBe(false);
    expect(isRateLimited('')).toBe(false);
  });

  it('matches a bare status 429, case-insensitively and across runs of whitespace', () => {
    expect(isRateLimited('status 429')).toBe(true);
    expect(isRateLimited('STATUS \t 429:')).toBe(true);
  });

  it('matches 429 Too Many Requests without a status prefix, case-insensitively', () => {
    expect(isRateLimited('429 Too Many Requests')).toBe(true);
    expect(isRateLimited('429  too   many \t requests')).toBe(true);
  });

  it('does not match a longer status code that starts with 429', () => {
    expect(isRateLimited('status 4290')).toBe(false);
  });

  it('does not match an unrelated 429 in other prose', () => {
    expect(isRateLimited('retry in 429 seconds')).toBe(false);
    expect(isRateLimited('status 500 Internal Server Error')).toBe(false);
  });
});
