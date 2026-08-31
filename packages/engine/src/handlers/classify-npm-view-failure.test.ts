/**
 * `classifyNpmViewFailure` unit tests (#650).
 *
 * The classifier is what stops `isPublished` from reading "we could not
 * reach npm" as "the version is not published", and what stops piot from
 * paying npm's error-blind retry ladder for a name that will never resolve.
 * Each case below pins one of the three readings, plus the boundaries
 * between them.
 */

import { describe, expect, it } from 'vitest';

import { classifyNpmViewFailure } from './classify-npm-view-failure.js';

describe('classifyNpmViewFailure', () => {
  it('reads a DNS failure as unreachable', () => {
    expect(classifyNpmViewFailure('npm error code ENOTFOUND\n')).toBe('unreachable');
    expect(classifyNpmViewFailure('npm error code EAI_AGAIN\n')).toBe('unreachable');
  });

  it('reads the legacy `npm ERR!` prefix too', () => {
    // npm ≤ 10 spells the same line `npm ERR! code …`, and consumer runners
    // are not all on npm 11.
    expect(classifyNpmViewFailure('npm ERR! code ENOTFOUND\n')).toBe('unreachable');
    expect(classifyNpmViewFailure('npm ERR! code E404\n')).toBe('absent');
  });

  it('finds the code line anywhere in a multi-line stderr block', () => {
    const stderr = [
      'npm warn using --force',
      'npm error code ENOTFOUND',
      'npm error syscall getaddrinfo',
      'npm error network request to https://registry.npmjs.org/demo-pkg failed',
    ].join('\n');
    expect(classifyNpmViewFailure(stderr)).toBe('unreachable');
  });

  it('reads a 404 as absent — the genuine "not published" answer', () => {
    expect(classifyNpmViewFailure('npm error code E404\nnpm error 404 Not Found\n')).toBe('absent');
  });

  it('reads timeouts, resets, 429 and 5xx as transient', () => {
    expect(classifyNpmViewFailure('npm error code ETIMEDOUT\n')).toBe('transient');
    expect(classifyNpmViewFailure('npm error code ECONNRESET\n')).toBe('transient');
    expect(classifyNpmViewFailure('npm error code ERR_SOCKET_TIMEOUT\n')).toBe('transient');
    expect(classifyNpmViewFailure('npm error code E429\n')).toBe('transient');
    expect(classifyNpmViewFailure('npm error code E500\n')).toBe('transient');
    expect(classifyNpmViewFailure('npm error code E503\n')).toBe('transient');
    expect(classifyNpmViewFailure('npm error code E599\n')).toBe('transient');
  });

  it('does not read 4xx or a malformed 5xx-lookalike as transient', () => {
    // The 5xx match is exactly three digits, anchored: `E401` is the
    // registry declining, not faltering, and `E5000` is not a status at all.
    expect(classifyNpmViewFailure('npm error code E401\n')).toBe('absent');
    expect(classifyNpmViewFailure('npm error code E403\n')).toBe('absent');
    expect(classifyNpmViewFailure('npm error code E5000\n')).toBe('absent');
    expect(classifyNpmViewFailure('npm error code E5\n')).toBe('absent');
    expect(classifyNpmViewFailure('npm error code XE503\n')).toBe('absent');
  });

  it('falls back to absent when there is no code line at all', () => {
    // Conservative default: an unparseable failure keeps the pre-#650
    // reading rather than inventing a new outcome for it.
    expect(classifyNpmViewFailure('')).toBe('absent');
    expect(classifyNpmViewFailure('some other tool exploded\n')).toBe('absent');
    // The prefix is load-bearing: prose that merely mentions a code is not
    // npm's machine-readable line.
    expect(classifyNpmViewFailure('the request failed with code ENOTFOUND\n')).toBe('absent');
    // ...and so is the line-start anchor.
    expect(classifyNpmViewFailure('  npm error code ENOTFOUND\n')).toBe('absent');
    // ...and so is the end-of-line anchor. A code line with trailing content
    // is not a shape npm emits, so it is not one we claim to understand:
    // without the `$`, this would read as a DNS failure and render UNKNOWN
    // for a registry that may well have answered.
    expect(classifyNpmViewFailure('npm error code ENOTFOUND and then some\n')).toBe('absent');
  });

  it('reads an unrecognised code as absent, not as a network failure', () => {
    expect(classifyNpmViewFailure('npm error code EEXIST\n')).toBe('absent');
  });
});
