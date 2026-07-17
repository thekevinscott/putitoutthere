import { describe, expect, it } from 'vitest';

import { toError } from './to-error.js';

describe('toError', () => {
  it('returns an Error value unchanged, preserving its identity', () => {
    const original = new TypeError('boom');
    const result = toError(original);
    // Same reference: type and stack are preserved, not re-wrapped.
    expect(result).toBe(original);
  });

  it('wraps a non-Error string in an Error whose message is the string', () => {
    const result = toError('kaboom');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('kaboom');
  });

  it('stringifies non-string, non-Error values into the message', () => {
    expect(toError(42).message).toBe('42');
    expect(toError(undefined).message).toBe('undefined');
    expect(toError({ toString: () => 'custom' }).message).toBe('custom');
  });
});
