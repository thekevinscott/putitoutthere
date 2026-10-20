import { describe, expect, it } from 'vitest';

import { extractProp } from './extract-prop.js';

describe('extractProp', () => {
  it('reads a present key', () => {
    expect(extractProp({ code: 'ECONNRESET' }, 'code')).toBe('ECONNRESET');
  });

  it('reads a key whose value is undefined', () => {
    expect(extractProp({ code: undefined }, 'code')).toBeUndefined();
  });

  it('returns undefined for a missing key', () => {
    expect(extractProp({}, 'code')).toBeUndefined();
  });

  it.each([null, undefined, 'str', 42])('returns undefined for non-object %s', (err) => {
    expect(extractProp(err, 'code')).toBeUndefined();
  });
});
