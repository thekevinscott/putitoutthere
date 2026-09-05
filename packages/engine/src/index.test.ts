import { describe, expect, it } from 'vitest';
import * as sdk from './index.js';

describe('SDK entry', () => {
  it('re-exports the error classes', () => {
    expect(sdk.AuthError).toBeDefined();
    expect(sdk.TransientError).toBeDefined();
  });

  // Identity, not existence: `resolve` and the reusable workflow must call the
  // same `plan` the release path runs. A re-wrap here is how a diagnostic
  // surface starts drifting from reality (design-commitments non-goal 7).
  it('re-exports plan itself, not a wrapper around it', async () => {
    const { plan } = await import('./plan.js');
    expect(sdk.plan).toBe(plan);
  });
});
