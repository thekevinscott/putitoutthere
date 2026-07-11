import { describe, expect, it } from 'vitest';
import * as sdk from './index.js';

describe('SDK entry', () => {
  it('re-exports the error classes', () => {
    expect(sdk.AuthError).toBeDefined();
    expect(sdk.TransientError).toBeDefined();
  });
});
