import { describe, expect, it } from 'vitest';

import { pypiNameFor } from './pypi-name-for.js';

describe('pypiNameFor', () => {
  it('prefers the pypi distribution name', () => {
    expect(pypiNameFor({ name: 'demo-python', pypi: 'demo-pkg' })).toBe('demo-pkg');
  });

  it('falls back to the package name', () => {
    expect(pypiNameFor({ name: 'demo-python' })).toBe('demo-python');
  });
});
