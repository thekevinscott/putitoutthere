/**
 * Pins `versionMatch`: the `ok:` line on a match, and the stderr-shaped error
 * line with `repr`-quoted values on a mismatch (including a null actual → None).
 */

import { describe, expect, it } from 'vitest';

import { versionMatch } from './version-match.js';

describe('versionMatch', () => {
  it('returns the ok line when actual equals expected', () => {
    expect(versionMatch({ name: 'foo.whl', label: 'METADATA', actual: '1.0.0', expected: '1.0.0' })).toEqual({
      okLine: 'ok: foo.whl METADATA Version=1.0.0',
    });
  });

  it('returns the error line with repr quoting on a mismatch', () => {
    expect(versionMatch({ name: 'foo.whl', label: 'METADATA', actual: '2.0.0', expected: '1.0.0' })).toEqual({
      errorLine: "foo.whl METADATA Version='2.0.0', expected '1.0.0'",
    });
  });

  it('renders a missing (null) actual version as None with the PKG-INFO label', () => {
    expect(versionMatch({ name: 'foo.tar.gz', label: 'PKG-INFO', actual: null, expected: '1.0.0' })).toEqual({
      errorLine: "foo.tar.gz PKG-INFO Version=None, expected '1.0.0'",
    });
  });
});
