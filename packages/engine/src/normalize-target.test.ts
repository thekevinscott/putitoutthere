import { describe, expect, it } from 'vitest';

import { normalizeTarget } from './normalize-target.js';

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
