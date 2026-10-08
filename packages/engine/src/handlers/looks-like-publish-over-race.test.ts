import { describe, expect, it } from 'vitest';

import { looksLikePublishOverRace } from './looks-like-publish-over-race.js';

describe('looksLikePublishOverRace', () => {
  it('matches npm\'s E403 over-publish stderr', () => {
    expect(
      looksLikePublishOverRace(
        'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.0.1.',
      ),
    ).toBe(true);
  });

  it('returns false on unrelated 403 stderr', () => {
    expect(looksLikePublishOverRace('npm error 403 Forbidden - PUT')).toBe(false);
    expect(looksLikePublishOverRace('npm ERR! 403 ENEEDAUTH')).toBe(false);
  });

  it('returns false on undefined / empty', () => {
    expect(looksLikePublishOverRace(undefined)).toBe(false);
    expect(looksLikePublishOverRace('')).toBe(false);
  });

  it('matches regardless of case', () => {
    expect(looksLikePublishOverRace('CANNOT PUBLISH OVER THE PREVIOUSLY PUBLISHED VERSIONS')).toBe(true);
  });
});
