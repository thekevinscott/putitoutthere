import { describe, expect, it } from 'vitest';

import { looksLikeAuthFailure } from './looks-like-auth-failure.js';

describe('looksLikeAuthFailure', () => {
  it.each([
    'npm error code E401',
    'npm error code E403',
    'npm error code E404',
    'npm error code ENEEDAUTH',
    'npm error code EAUTH',
    'npm error need auth This command requires you to be logged in',
    'npm error You are not authorized to publish',
    'npm error You are not authorised to publish',
    'npm error 401 Unauthorized - PUT',
    'npm error 403 Forbidden - PUT',
  ])('matches %j', (stderr) => {
    expect(looksLikeAuthFailure(stderr)).toBe(true);
  });

  it('matches regardless of case', () => {
    expect(looksLikeAuthFailure('NPM ERROR NEED AUTH')).toBe(true);
  });

  it('needs a word boundary on both sides of the match', () => {
    expect(looksLikeAuthFailure('npm error code XE401')).toBe(false);
    expect(looksLikeAuthFailure('npm error code E4010')).toBe(false);
  });

  it('returns false on unrelated stderr', () => {
    expect(looksLikeAuthFailure('npm error code E500 Internal Server Error')).toBe(false);
  });

  it('returns false on undefined / empty', () => {
    expect(looksLikeAuthFailure(undefined)).toBe(false);
    expect(looksLikeAuthFailure('')).toBe(false);
  });
});
