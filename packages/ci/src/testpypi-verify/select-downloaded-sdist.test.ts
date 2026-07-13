/**
 * Pins `selectDownloadedSdist`: the exact `{stem}-{version}.tar.gz` basename
 * (no wildcard), and null for any near-miss.
 */

import { describe, expect, it } from 'vitest';

import { selectDownloadedSdist } from './select-downloaded-sdist.js';

describe('selectDownloadedSdist', () => {
  it('selects the exact sdist basename', () => {
    expect(selectDownloadedSdist(['stem-1.0.tar.gz', 'stem-1.0-cp.whl'], 'stem', '1.0')).toBe('stem-1.0.tar.gz');
  });

  it('returns null when the exact name is absent', () => {
    expect(selectDownloadedSdist(['stem-1.0.1.tar.gz'], 'stem', '1.0')).toBeNull();
  });

  it('does not match a merely-prefixed name (exact match only)', () => {
    expect(selectDownloadedSdist(['stem-1.0.tar.gz.bak'], 'stem', '1.0')).toBeNull();
  });
});
