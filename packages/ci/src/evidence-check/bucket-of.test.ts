import { describe, expect, it } from 'vitest';

import { bucketOf } from './bucket-of.js';

describe('bucketOf', () => {
  it('returns the segment before the first slash', () => {
    expect(bucketOf('e2e/js-vanilla-firstpub')).toBe('e2e');
  });

  it('returns the whole string when there is no slash', () => {
    expect(bucketOf('unit')).toBe('unit');
  });

  it('returns only the first segment for nested paths', () => {
    expect(bucketOf('consumer-template/a/b')).toBe('consumer-template');
  });

  it('returns an empty bucket for a leading slash', () => {
    expect(bucketOf('/x')).toBe('');
  });
});
