import { describe, expect, it } from 'vitest';

import { normalize } from './normalize.js';

describe('normalize', () => {
  it('lowercases and collapses non-alphanumerics to slashes', () => {
    expect(normalize('E2E / js-vanilla')).toBe('e2e/js/vanilla');
  });

  it('strips leading and trailing slashes', () => {
    expect(normalize('  .github/workflows/e2e.yml  ')).toBe('github/workflows/e2e/yml');
  });

  it('treats null/undefined as the empty string', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});
