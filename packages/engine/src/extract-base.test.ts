import { describe, expect, it } from 'vitest';

import { extractBase } from './extract-base.js';

describe('extractBase', () => {
  it('returns the base of a scoped name', () => {
    expect(extractBase('@myorg/cli')).toBe('cli');
  });

  it('returns the whole name when unscoped', () => {
    expect(extractBase('my-cli')).toBe('my-cli');
  });

  it('treats a name as scoped only when the whole name is @scope/base', () => {
    expect(extractBase('x@org/cli')).toBe('x@org/cli');
    expect(extractBase('@org/cli\nx')).toBe('@org/cli\nx');
  });

  it('requires a non-empty scope and base', () => {
    expect(extractBase('@/cli')).toBe('@/cli');
    expect(extractBase('@org/')).toBe('@org/');
  });

  it('keeps everything after the first slash as the base', () => {
    expect(extractBase('@org/sub/cli')).toBe('sub/cli');
  });
});
