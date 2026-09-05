import { describe, expect, it } from 'vitest';

import { elideMiddle } from './elide-middle.js';

/** The defaults the module ships, pinned here so the budget itself is a contract. */
const DEFAULT_HEAD = 4 * 1024;
const DEFAULT_TAIL = 16 * 1024;

describe('elideMiddle (#651)', () => {
  it('returns a string that already fits untouched', () => {
    expect(elideMiddle('error: boom', { head: 8, tail: 8 })).toBe('error: boom');
  });

  it('leaves a string of exactly the budget untouched', () => {
    // The boundary: 16 characters against head 8 + tail 8 is the largest
    // input with nothing to drop. Eliding here would announce "0 bytes
    // elided" over a stream that lost nothing.
    expect(elideMiddle('abcdefghijklmnop', { head: 8, tail: 8 })).toBe('abcdefghijklmnop');
  });

  it('drops the middle of a string one character over the budget', () => {
    expect(elideMiddle('abcdefghXijklmnop', { head: 8, tail: 8 })).toBe(
      'abcdefgh\n\n[... 1 bytes elided ...]\n\nijklmnop',
    );
  });

  it('keeps the head and the tail, and nothing between them', () => {
    expect(elideMiddle(`HEAD${'x'.repeat(500)}TAIL`, { head: 4, tail: 4 })).toBe(
      'HEAD\n\n[... 500 bytes elided ...]\n\nTAIL',
    );
  });

  it('counts exactly the bytes it dropped', () => {
    // The count is what tells a reader the stream continued rather than
    // stopped, so an off-by-anything here misdescribes the evidence.
    const marker = /\[\.\.\. (\d+) bytes elided \.\.\.\]/.exec(
      elideMiddle('y'.repeat(1000), { head: 100, tail: 250 }),
    );
    expect(marker?.[1]).toBe('650');
  });

  it('keeps a 380KB stream inside the 64KB GitHub cuts a log line at', () => {
    // The scenario from #651: a cold `cargo publish --verbose` verify build
    // on the crate in the issue produced ~380KB of stderr. Defaults, not
    // per-call options — the call sites pass none.
    expect(elideMiddle('q'.repeat(380 * 1024)).length).toBeLessThanOrEqual(64 * 1024);
  });

  it('defaults to keeping more of the tail than the head', () => {
    // Deliberate asymmetry: the head only has to name the phase that was
    // running, while the tail is the error itself plus its `Caused by:`
    // frames. Split on the blank lines that fence the marker.
    const [head, , tail] = elideMiddle(
      `${'h'.repeat(200 * 1024)}${'t'.repeat(200 * 1024)}`,
    ).split('\n\n');
    expect({ head: head?.length, tail: tail?.length }).toEqual({
      head: DEFAULT_HEAD,
      tail: DEFAULT_TAIL,
    });
  });

  it('takes the tail from the end of the stream, not from the head side', () => {
    // A slice measured from the wrong end would still be `tail` characters
    // long and still pass a length check — this is the assertion that says
    // which characters they are.
    const [, , tail] = elideMiddle(
      `${'h'.repeat(200 * 1024)}error: could not compile`,
    ).split('\n\n');
    expect(tail?.endsWith('error: could not compile')).toBe(true);
  });
});
