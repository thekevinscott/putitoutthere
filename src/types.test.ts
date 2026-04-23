import { describe, expect, it } from 'vitest';
import { AuthError, TransientError, normalizeTarget } from './types.js';

describe('error classes', () => {
  it('AuthError exposes its name and message', () => {
    const e = new AuthError('bad token');
    expect(e.name).toBe('AuthError');
    expect(e.message).toBe('bad token');
    expect(e instanceof Error).toBe(true);
  });

  it('TransientError exposes its name and message', () => {
    const e = new TransientError('registry 502');
    expect(e.name).toBe('TransientError');
    expect(e.message).toBe('registry 502');
    expect(e instanceof Error).toBe(true);
  });
});

describe('normalizeTarget (#159)', () => {
  it('normalizes a bare-string target to the triple-only object form', () => {
    expect(normalizeTarget('x86_64-unknown-linux-gnu')).toEqual({
      triple: 'x86_64-unknown-linux-gnu',
    });
  });

  it('preserves triple + runner when both are present', () => {
    expect(
      normalizeTarget({ triple: 'aarch64-unknown-linux-gnu', runner: 'ubuntu-24.04-arm' }),
    ).toEqual({
      triple: 'aarch64-unknown-linux-gnu',
      runner: 'ubuntu-24.04-arm',
    });
  });

  it('omits runner when absent on the object form', () => {
    const n = normalizeTarget({ triple: 'x86_64-pc-windows-msvc' });
    expect(n.triple).toBe('x86_64-pc-windows-msvc');
    expect('runner' in n).toBe(false);
  });
});
