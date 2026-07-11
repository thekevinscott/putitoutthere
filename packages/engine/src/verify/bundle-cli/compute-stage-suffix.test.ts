/**
 * `computeStageSuffix` — leading-`./` strip + `python-source` subtraction
 * (#451).
 */

import { describe, expect, it } from 'vitest';

import { computeStageSuffix } from './compute-stage-suffix.js';

describe('computeStageSuffix', () => {
  it('returns stage_to unchanged when python-source is empty', () => {
    expect(computeStageSuffix('dirsql/_binary', '')).toBe('dirsql/_binary');
  });

  it('strips a single leading ./', () => {
    expect(computeStageSuffix('./stage/bin', '')).toBe('stage/bin');
  });

  it('subtracts an exact python-source prefix', () => {
    expect(computeStageSuffix('python/dirsql/_binary', 'python')).toBe('dirsql/_binary');
  });

  it('strips ./ before subtracting the python-source prefix', () => {
    expect(computeStageSuffix('./python/dirsql/_binary', 'python')).toBe('dirsql/_binary');
  });

  it('leaves stage_to unchanged when python-source is set but is not a prefix', () => {
    // The consumer's misconfiguration to surface, not this function's to fix.
    expect(computeStageSuffix('dirsql/_binary', 'python')).toBe('dirsql/_binary');
  });

  it('does not strip a python-source that only partially matches a segment', () => {
    // `py` is not the segment `python`, so `python/...` is left intact.
    expect(computeStageSuffix('python/bin', 'py')).toBe('python/bin');
  });
});
