/**
 * Pins `isPlanFixtureVersion`: a plan-stamped `0.0.<unix-seconds>` passes, the
 * `0.0.1` build-mode baseline is rejected even though it matches the shape, and
 * versions from any other source are rejected on shape alone (#672).
 */

import { describe, expect, it } from 'vitest';

import { isPlanFixtureVersion } from './is-plan-fixture-version.js';

describe('isPlanFixtureVersion', () => {
  it('accepts a plan-stamped unix-seconds version', () => {
    expect(isPlanFixtureVersion('0.0.1700000000')).toBe(true);
  });

  it('rejects the 0.0.1 build-mode baseline despite its matching shape', () => {
    expect(isPlanFixtureVersion('0.0.1')).toBe(false);
  });

  it('accepts a short patch that is not the baseline literal', () => {
    expect(isPlanFixtureVersion('0.0.2')).toBe(true);
  });

  it('rejects a hatch-vcs fallback version', () => {
    expect(isPlanFixtureVersion('0.1.dev1+g1234567')).toBe(false);
  });

  it('rejects a released-looking version outside the 0.0.x line', () => {
    expect(isPlanFixtureVersion('1.2.3')).toBe(false);
  });

  it('rejects a non-numeric patch segment', () => {
    expect(isPlanFixtureVersion('0.0.1rc1')).toBe(false);
  });

  it('anchors at the start: a version that merely ends in a 0.0.<digits> run is not one', () => {
    // `10.0.123` contains `0.0.123`, so an unanchored match would accept it.
    expect(isPlanFixtureVersion('10.0.123')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isPlanFixtureVersion('')).toBe(false);
  });
});
