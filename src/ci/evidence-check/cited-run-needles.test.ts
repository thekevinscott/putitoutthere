import { describe, expect, it } from 'vitest';

import { ALLOWED_BUCKETS } from './allowed-buckets.js';
import { citedRunNeedles } from './cited-run-needles.js';
import type { Bullet } from './types.js';

const bullet = (text: string): Bullet => ({ line: 1, text });

describe('citedRunNeedles', () => {
  it('collects citations from `verified by` rows whose bucket is allowed', () => {
    const bullets = [bullet('- x (verified by: e2e/a, integration/b)')];
    expect([...citedRunNeedles(bullets, ALLOWED_BUCKETS)]).toEqual(['e2e/a', 'integration/b']);
  });

  it('skips rows with no evidence clause and `no fixture` rows', () => {
    const bullets = [bullet('- no clause'), bullet('- x (no fixture: reason)')];
    expect(citedRunNeedles(bullets, ALLOWED_BUCKETS).size).toBe(0);
  });

  it('drops citations whose bucket is not allowed', () => {
    const bullets = [bullet('- x (verified by: e2e/a, bogus/b)')];
    expect([...citedRunNeedles(bullets, ALLOWED_BUCKETS)]).toEqual(['e2e/a']);
  });
});
