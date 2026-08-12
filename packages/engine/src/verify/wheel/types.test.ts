// The runtime (non-`type`) import is deliberate: it loads the module so
// coverage sees the file at all — a `import type` would be erased and the
// declaration-only module would never register as exercised.
import './types.js';

import { describe, expect, it } from 'vitest';
import type { VerifyWheelOptions } from './types.js';

describe('VerifyWheelOptions surface', () => {
  it('carries the #450 fields plus the optional #610 manylinux baseline', () => {
    const opts: VerifyWheelOptions = {
      cwd: '/work',
      path: 'pkg',
      version: '1.2.3',
      target: 'x86_64-unknown-linux-gnu',
      manylinux: '2_28',
    };
    expect(opts.manylinux).toBe('2_28');
  });

  it('keeps manylinux optional (sdist rows configure none)', () => {
    const opts: VerifyWheelOptions = {
      cwd: '/work',
      path: 'pkg',
      version: '1.2.3',
      target: 'sdist',
    };
    expect('manylinux' in opts).toBe(false);
  });
});
