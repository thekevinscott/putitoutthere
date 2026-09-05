import { describe, expect, it } from 'vitest';
import * as sdk from './index.js';

describe('SDK entry', () => {
  it('re-exports the error classes', () => {
    expect(sdk.AuthError).toBeDefined();
    expect(sdk.TransientError).toBeDefined();
  });

  it('re-exports plan itself, not a wrapper around it', async () => {
    const { plan } = await import('./plan.js');
    expect(sdk.plan).toBe(plan);
  });
});
