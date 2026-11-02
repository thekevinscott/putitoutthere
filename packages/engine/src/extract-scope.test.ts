import { describe, expect, it } from 'vitest';

import { extractScope } from './extract-scope.js';

describe('extractScope', () => {
  it('returns the scope of a scoped name', () => {
    expect(extractScope('@myorg/cli')).toBe('myorg');
  });

  it('returns empty for an unscoped name', () => {
    expect(extractScope('my-cli')).toBe('');
  });

  it('treats a name as scoped only when the whole name is @scope/base', () => {
    expect(extractScope('x@org/cli')).toBe('');
    expect(extractScope('@org/cli\nx')).toBe('');
  });

  it('requires a non-empty scope and base', () => {
    expect(extractScope('@/cli')).toBe('');
    expect(extractScope('@org/')).toBe('');
  });

  it('stops the scope at the first slash', () => {
    expect(extractScope('@org/sub/cli')).toBe('org');
  });
});
