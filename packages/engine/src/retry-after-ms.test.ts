import { describe, expect, it, vi } from 'vitest';

import { retryAfterMs } from './retry-after-ms.js';

vi.mock('./extract-prop.js', async () => await vi.importActual<typeof import('./extract-prop.js')>('./extract-prop.js'));

describe('retryAfterMs', () => {
  it('converts a positive retryAfter in seconds to milliseconds', () => {
    expect(retryAfterMs({ retryAfter: 7 })).toBe(7000);
  });

  it.each([0, -1])('returns 0 for retryAfter %i', (retryAfter) => {
    expect(retryAfterMs({ retryAfter })).toBe(0);
  });

  it('returns 0 for a non-numeric retryAfter', () => {
    expect(retryAfterMs({ retryAfter: '7' })).toBe(0);
  });

  it('returns 0 when there is no retryAfter', () => {
    expect(retryAfterMs(new Error('x'))).toBe(0);
  });
});
