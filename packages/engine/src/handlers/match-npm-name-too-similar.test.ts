import { describe, expect, it } from 'vitest';

import { matchNpmNameTooSimilar } from './match-npm-name-too-similar.js';

describe('matchNpmNameTooSimilar (#617)', () => {
  it('returns the stderr verbatim on the canonical E403 moniker stderr', () => {
    const stderr = [
      'npm error code E403',
      "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/demopkg - Package name too similar to existing package demo-pkg; try renaming your package to '@demo-scope/demopkg' instead.",
      'npm error 403 In most cases, you or one of your dependencies are requesting a package version that is forbidden by your security policy, or on a server you do not have access to.',
    ].join('\n');
    expect(matchNpmNameTooSimilar(stderr)).toBe(stderr);
  });

  it('matches the plural variant, which names no blocking package', () => {
    // npm emits this wording when it will not disclose which package
    // collides. Same refusal, same remedy.
    const stderr =
      "npm error 403 Package name too similar to existing packages; try renaming your package to '@user/demopkg' and publishing with '--access public' instead";
    expect(matchNpmNameTooSimilar(stderr)).toBe(stderr);
  });

  it('returns null on an ordinary E403 — the over-publish race', () => {
    // The race that `looksLikePublishOverRace` short-circuits to
    // already-published. Matching the status code instead of the prose
    // would swallow it and raise a naming error on a publish that
    // actually landed.
    expect(
      matchNpmNameTooSimilar(
        'npm error code E403\nnpm error 403 403 Forbidden - PUT https://registry.npmjs.org/demopkg - You cannot publish over the previously published versions: 0.1.0.',
      ),
    ).toBeNull();
  });

  it('returns null on the E404 that masks an unauthorized publish', () => {
    // The genuine bootstrap case (#598). It must keep reaching the
    // NODE_AUTH_TOKEN hint — this matcher runs first and has to let it by.
    expect(
      matchNpmNameTooSimilar(
        "npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/demo-pkg - Not found\nnpm error 404  The requested resource 'demo-pkg@0.1.0' could not be found or you do not have permission to access it.",
      ),
    ).toBeNull();
  });

  it('returns null when the prose is about something other than a name', () => {
    expect(
      matchNpmNameTooSimilar('npm error 403 Forbidden - this package is too similar to a blocked one'),
    ).toBeNull();
  });

  it('returns null on an undefined stderr (defensive)', () => {
    expect(matchNpmNameTooSimilar(undefined)).toBeNull();
  });

  // Empty string flows past the `stderr !== undefined` guard; no anchor
  // matches, so the result is null. Pins the guard against a rewrite that
  // would return '' verbatim for empty stderr.
  it('returns null on empty string', () => {
    expect(matchNpmNameTooSimilar('')).toBeNull();
  });

  // Whitespace near-misses. Every inter-token gap in the anchor is `\s+`
  // (one-or-more), and npm wraps long lines, so each gap has to survive
  // more than a single space. Feeding *two* spaces at **every** gap is
  // what pins that: collapse any one `\s+` to `\s` and this stops
  // matching. One gap at a time would leave the other five unpinned.
  it('matches with two spaces at every gap (pins all six gaps as \\s+)', () => {
    const stderr =
      'npm error 403 Package  name  too  similar  to  existing  packages';
    expect(matchNpmNameTooSimilar(stderr)).toBe(stderr);
  });

  it('matches across a line wrap, which is what npm actually emits', () => {
    const stderr = 'npm error 403 Package name too\nsimilar to existing\npackage demo-pkg';
    expect(matchNpmNameTooSimilar(stderr)).toBe(stderr);
  });

  it('is case-insensitive — npm has shipped both cased forms', () => {
    const stderr = 'npm error 403 PACKAGE NAME TOO SIMILAR TO EXISTING PACKAGE demo-pkg';
    expect(matchNpmNameTooSimilar(stderr)).toBe(stderr);
  });
});
