import { describe, expect, it } from 'vitest';

import { splitCitations } from './split-citations.js';

describe('splitCitations', () => {
  it('splits a comma-separated list and trims each entry', () => {
    expect(splitCitations('e2e/a, unit/b ,integration/c')).toEqual(['e2e/a', 'unit/b', 'integration/c']);
  });

  it('drops empty entries produced by stray commas or whitespace', () => {
    expect(splitCitations('e2e/a, ,  , unit/b')).toEqual(['e2e/a', 'unit/b']);
  });

  it('returns a single citation unchanged', () => {
    expect(splitCitations('unit/x')).toEqual(['unit/x']);
  });

  it('returns an empty list for an empty value', () => {
    expect(splitCitations('')).toEqual([]);
  });
});
