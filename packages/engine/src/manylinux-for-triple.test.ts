import { describe, expect, it } from 'vitest';

import { manylinuxForTriple } from './manylinux-for-triple.js';

describe('manylinuxForTriple (#610)', () => {
  it('returns undefined when no baseline is configured', () => {
    expect(manylinuxForTriple('x86_64-unknown-linux-gnu', undefined)).toBeUndefined();
  });

  it('applies a manylinux value to gnu triples', () => {
    expect(manylinuxForTriple('x86_64-unknown-linux-gnu', '2_28')).toBe('2_28');
    expect(manylinuxForTriple('aarch64-unknown-linux-gnu', '2_28')).toBe('2_28');
  });

  it('applies a manylinux value to eabi gnu variants', () => {
    expect(manylinuxForTriple('armv7-unknown-linux-gnueabihf', '2014')).toBe('2014');
  });

  it('does not apply a manylinux value to musl or non-linux triples', () => {
    expect(manylinuxForTriple('x86_64-unknown-linux-musl', '2_28')).toBeUndefined();
    expect(manylinuxForTriple('x86_64-apple-darwin', '2_28')).toBeUndefined();
    expect(manylinuxForTriple('x86_64-pc-windows-msvc', '2_28')).toBeUndefined();
  });

  it('applies a musllinux value to musl triples only', () => {
    expect(manylinuxForTriple('x86_64-unknown-linux-musl', 'musllinux_1_2')).toBe('musllinux_1_2');
    expect(manylinuxForTriple('arm-unknown-linux-musleabi', 'musllinux_1_2')).toBe('musllinux_1_2');
    expect(manylinuxForTriple('x86_64-unknown-linux-gnu', 'musllinux_1_2')).toBeUndefined();
    expect(manylinuxForTriple('x86_64-apple-darwin', 'musllinux_1_2')).toBeUndefined();
  });
});
