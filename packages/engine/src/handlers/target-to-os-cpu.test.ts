import { describe, expect, it } from 'vitest';

import { targetToOsCpu } from './target-to-os-cpu.js';

describe('targetToOsCpu', () => {
  it('maps linux-x64-gnu → os:linux cpu:x64 libc:glibc', () => {
    expect(targetToOsCpu('linux-x64-gnu')).toStrictEqual({
      os: ['linux'],
      cpu: ['x64'],
      libc: ['glibc'],
    });
  });

  it('maps linux-x64-musl → libc:musl', () => {
    expect(targetToOsCpu('linux-x64-musl').libc).toEqual(['musl']);
  });

  it('maps darwin-arm64 → os:darwin cpu:arm64, with no libc key', () => {
    expect(targetToOsCpu('darwin-arm64')).toStrictEqual({ os: ['darwin'], cpu: ['arm64'] });
  });

  it('maps aarch64-unknown-linux-gnu → linux arm64 glibc', () => {
    expect(targetToOsCpu('aarch64-unknown-linux-gnu')).toStrictEqual({
      os: ['linux'],
      cpu: ['arm64'],
      libc: ['glibc'],
    });
  });

  it('maps x86_64-pc-windows-msvc → os:win32 cpu:x64', () => {
    expect(targetToOsCpu('x86_64-pc-windows-msvc')).toStrictEqual({ os: ['win32'], cpu: ['x64'] });
  });

  it('is case-insensitive', () => {
    expect(targetToOsCpu('DARWIN-ARM64')).toStrictEqual({ os: ['darwin'], cpu: ['arm64'] });
  });

  it('throws a descriptive error for unknown triples (#170)', () => {
    expect(() => targetToOsCpu('riscv64-unknown-linux-gnu')).toThrow(
      new Error('Target triple "riscv64-unknown-linux-gnu" is not mapped to npm os/cpu. Add it to TRIPLE_MAP in src/handlers/npm-platform.ts.'),
    );
  });
});
