/**
 * Pins `errorMessage`: an `Error`'s `message`, otherwise the stringified value.
 */

import { describe, expect, it } from 'vitest';

import { errorMessage } from './error-message.js';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(errorMessage('plain')).toBe('plain');
  });

  it('stringifies a number', () => {
    expect(errorMessage(42)).toBe('42');
  });
});
