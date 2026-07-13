/**
 * Pins that `applySubstitutions` reproduces the bash `sed`/`perl` global
 * literal replace: every occurrence of each `from`, applied in order, treated
 * as a fixed string (not a regex). Pure — driven by plain inputs.
 */

import { describe, expect, it } from 'vitest';

import { applySubstitutions } from './apply-substitutions.js';

describe('applySubstitutions', () => {
  it('replaces every occurrence of a token, not just the first', () => {
    expect(applySubstitutions('a __VERSION__ b __VERSION__', [{ from: '__VERSION__', to: '1.2.3' }])).toBe(
      'a 1.2.3 b 1.2.3',
    );
  });

  it('applies substitutions in order', () => {
    expect(
      applySubstitutions('__VERSION__ pkg-placeholder', [
        { from: '__VERSION__', to: '0.0.1' },
        { from: '-placeholder', to: '-77-1' },
      ]),
    ).toBe('0.0.1 pkg-77-1');
  });

  it('returns the content unchanged when no token is present', () => {
    expect(applySubstitutions('no tokens here', [{ from: '__VERSION__', to: '9' }])).toBe('no tokens here');
  });

  it('treats the token as a literal string, not a regex pattern', () => {
    expect(applySubstitutions('a.b', [{ from: '.', to: 'X' }])).toBe('aXb');
  });

  it('returns the content unchanged with an empty substitution list', () => {
    expect(applySubstitutions('__VERSION__', [])).toBe('__VERSION__');
  });
});
