import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractIncludePath } from './extract-include-path.js';
import { maturinIncludeCovers } from './maturin-include-covers.js';

vi.mock('./extract-include-path.js');

beforeEach(() => {
  vi.mocked(extractIncludePath).mockReset();
  vi.mocked(extractIncludePath).mockImplementation((entry) =>
    typeof entry === 'string' ? entry : undefined,
  );
});

describe('maturinIncludeCovers', () => {
  it('covers stage_to exactly, with or without a trailing glob or slash', () => {
    expect(maturinIncludeCovers(['a/bin'], 'a/bin')).toBe(true);
    expect(maturinIncludeCovers(['a/bin/'], 'a/bin')).toBe(true);
    expect(maturinIncludeCovers(['a/bin/*'], 'a/bin')).toBe(true);
    expect(maturinIncludeCovers(['a/bin/**'], 'a/bin')).toBe(true);
    expect(maturinIncludeCovers(['a/bin*'], 'a/bin')).toBe(true);
  });

  it('covers stage_to from a parent directory entry', () => {
    expect(maturinIncludeCovers(['a/*'], 'a/bin')).toBe(true);
    expect(maturinIncludeCovers(['a'], 'a/bin')).toBe(true);
  });

  it('does not treat a bare glob as covering everything', () => {
    expect(maturinIncludeCovers(['*'], 'a/bin')).toBe(false);
    expect(maturinIncludeCovers(['*'], '/abs/bin')).toBe(false);
  });

  it('covers a stage_to that is itself a bare glob when listed verbatim', () => {
    expect(maturinIncludeCovers(['*'], '*')).toBe(true);
  });

  it('does not treat a sibling with a shared prefix as a parent', () => {
    expect(maturinIncludeCovers(['ab'], 'ab-bin/x')).toBe(false);
  });

  it('covers stage_to from a child path entry', () => {
    expect(maturinIncludeCovers(['a/bin/tool'], 'a/bin')).toBe(true);
  });

  it('does not treat a sibling sharing the stage_to prefix as a child', () => {
    expect(maturinIncludeCovers(['a/binary'], 'a/bin')).toBe(false);
  });

  it('skips entries with no usable path and keeps scanning', () => {
    expect(maturinIncludeCovers([{ format: 'sdist' }, 'other', 'a/bin'], 'a/bin')).toBe(true);
    expect(extractIncludePath).toHaveBeenCalledWith({ format: 'sdist' });
  });

  it('is false for an empty include list', () => {
    expect(maturinIncludeCovers([], 'a/bin')).toBe(false);
  });

  it('strips only a trailing glob, not one mid-path', () => {
    expect(maturinIncludeCovers(['a/*/bin'], 'a/bin')).toBe(false);
  });

  it('strips a multi-star trailing glob so the parent covers a nested stage_to', () => {
    expect(maturinIncludeCovers(['a/**'], 'a/bin/x')).toBe(true);
  });
});
