import { describe, expect, it } from 'vitest';

import { parseTrailerPayload } from './parse-trailer-payload.js';

describe('parseTrailerPayload', () => {
  it.each(['patch', 'minor', 'major', 'skip'] as const)('accepts a bare %s', (bump) => {
    expect(parseTrailerPayload(bump)).toEqual({ bump, packages: [] });
  });

  it('ignores surrounding whitespace', () => {
    expect(parseTrailerPayload('  patch  ')).toEqual({ bump: 'patch', packages: [] });
    expect(parseTrailerPayload(' minor [a]  ')).toEqual({ bump: 'minor', packages: ['a'] });
  });

  it('rejects an empty payload', () => {
    expect(parseTrailerPayload('')).toBeNull();
    expect(parseTrailerPayload('   ')).toBeNull();
  });

  it('rejects an unknown value', () => {
    expect(parseTrailerPayload('yeet')).toBeNull();
    expect(parseTrailerPayload('PATCH')).toBeNull();
  });

  it('parses a value followed by a package list', () => {
    expect(parseTrailerPayload('minor [a, b]')).toEqual({ bump: 'minor', packages: ['a', 'b'] });
  });

  it('parses a list with no space before the bracket', () => {
    expect(parseTrailerPayload('patch[a]')).toEqual({ bump: 'patch', packages: ['a'] });
  });

  it('rejects an unknown value even with a valid list', () => {
    expect(parseTrailerPayload('yeet [a]')).toBeNull();
  });

  it('rejects a malformed list', () => {
    expect(parseTrailerPayload('minor [a, b')).toBeNull();
  });
});
