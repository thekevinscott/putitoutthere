import { describe, expect, it } from 'vitest';

import { assertTripleSupported } from './assert-triple-supported.js';

describe('assertTripleSupported (#170)', () => {
  it('does not throw for a triple that is mapped in TRIPLE_MAP', () => {
    expect(() => assertTripleSupported('linux-x64-gnu', 'demo-cli')).not.toThrow();
  });

  it('is case-insensitive, mirroring targetToOsCpu', () => {
    expect(() => assertTripleSupported('LINUX-X64-GNU', 'demo-cli')).not.toThrow();
  });

  it('throws naming the offending package and TRIPLE_MAP for an unmapped triple', () => {
    expect(() => assertTripleSupported('riscv64-unknown-linux-gnu', 'demo-cli')).toThrow(
      new Error('Package "demo-cli": Target triple "riscv64-unknown-linux-gnu" is not mapped to npm os/cpu. Add it to TRIPLE_MAP in src/handlers/npm-platform.ts.'),
    );
  });
});
