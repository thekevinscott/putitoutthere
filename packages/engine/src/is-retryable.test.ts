import { describe, expect, it, vi } from 'vitest';

import { isRetryable } from './is-retryable.js';
import { AuthError, TransientError } from './types.js';

vi.mock('./types.js');
vi.mock('./extract-prop.js', async () => await vi.importActual<typeof import('./extract-prop.js')>('./extract-prop.js'));

describe('isRetryable', () => {
  it('retries a TransientError', () => {
    expect(isRetryable(new TransientError('5xx'))).toBe(true);
  });

  it('never retries an AuthError, even one tagged 5xx', () => {
    expect(isRetryable(Object.assign(new AuthError('bad token'), { status: 503 }))).toBe(false);
  });

  it('does not retry an arbitrary Error', () => {
    expect(isRetryable(new Error('weird'))).toBe(false);
  });

  it.each(['ECONNRESET', 'ETIMEDOUT'])('retries network code %s', (code) => {
    expect(isRetryable(Object.assign(new Error('socket'), { code }))).toBe(true);
  });

  it('does not retry other error codes', () => {
    expect(isRetryable(Object.assign(new Error('socket'), { code: 'ENOENT' }))).toBe(false);
  });

  it.each([429, 500, 503, 599])('retries status %i', (status) => {
    expect(isRetryable(Object.assign(new Error('http'), { status }))).toBe(true);
  });

  it.each([400, 404, 499, 600])('does not retry status %i', (status) => {
    expect(isRetryable(Object.assign(new Error('http'), { status }))).toBe(false);
  });

  it('does not retry a non-numeric status', () => {
    expect(isRetryable(Object.assign(new Error('http'), { status: '503' }))).toBe(false);
  });
});
