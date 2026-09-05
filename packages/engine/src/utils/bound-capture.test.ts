import { describe, expect, it } from 'vitest';
import { boundCapture } from './bound-capture.js';

const BANNER = '[putitoutthere] capture ceiling reached: dropped';

describe('boundCapture', () => {
  it('leaves a stream that exactly fills the ceiling untouched', () => {
    expect(boundCapture('abcdefghij', 10)).toBe('abcdefghij');
  });

  it('bounds a stream one character past the ceiling', () => {
    expect(boundCapture('abcdefghijk', 10)).toBe(`${BANNER} 1 bytes\nabcdeghijk`);
  });

  it('keeps both ends and reports the exact drop', () => {
    expect(boundCapture('abcdefghijklmnopqrstuvwxyz', 10)).toBe(`${BANNER} 16 bytes\nabcdevwxyz`);
  });

  it('splits an odd ceiling head-light', () => {
    expect(boundCapture('abcdefghijklmnopqrstuvwxyz', 7)).toBe(`${BANNER} 19 bytes\nabcwxyz`);
  });

  it('retains exactly the ceiling, banner aside', () => {
    const bounded = boundCapture('x'.repeat(1000), 100);
    expect(bounded.slice(bounded.indexOf('\n') + 1)).toHaveLength(100);
  });

  it('leaves an empty stream alone', () => {
    expect(boundCapture('', 10)).toBe('');
  });
});
