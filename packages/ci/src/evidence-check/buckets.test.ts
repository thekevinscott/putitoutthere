import { describe, expect, it } from 'vitest';

import { ALLOWED_BUCKETS } from './buckets.js';

describe('ALLOWED_BUCKETS', () => {
  it('is exactly the four accepted verification buckets', () => {
    expect([...ALLOWED_BUCKETS]).toEqual(['e2e', 'integration', 'unit', 'consumer-template']);
  });

  it('does not admit an unlisted bucket', () => {
    expect(ALLOWED_BUCKETS.has('smoke')).toBe(false);
  });
});
