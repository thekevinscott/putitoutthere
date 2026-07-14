/**
 * Pins `selectDownloadedWheel`: the lexicographically first basename starting
 * `{stem}-{version}-` and ending `.whl`, and null when the version, prefix
 * boundary, or `.whl` suffix does not match.
 */

import { describe, expect, it } from 'vitest';

import { selectDownloadedWheel } from './select-downloaded-wheel.js';

describe('selectDownloadedWheel', () => {
  it('selects the matching wheel and ignores others', () => {
    expect(
      selectDownloadedWheel(
        ['piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-linux.whl', 'other-1.0-py3-none-any.whl'],
        'piot_fixture_zzz_python_maturin',
        '0.0.1',
      ),
    ).toBe('piot_fixture_zzz_python_maturin-0.0.1-cp312-cp312-linux.whl');
  });

  it('returns the lexicographically first of several matches', () => {
    expect(selectDownloadedWheel(['stem-1.0-b.whl', 'stem-1.0-a.whl'], 'stem', '1.0')).toBe('stem-1.0-a.whl');
  });

  it('returns null when no wheel matches the version', () => {
    expect(selectDownloadedWheel(['stem-2.0-a.whl'], 'stem', '1.0')).toBeNull();
  });

  it('returns null without the version-dash boundary', () => {
    expect(selectDownloadedWheel(['stem-1.0.whl'], 'stem', '1.0')).toBeNull();
  });

  it('returns null for a non-.whl suffix', () => {
    expect(selectDownloadedWheel(['stem-1.0-x.tar.gz'], 'stem', '1.0')).toBeNull();
  });
});
