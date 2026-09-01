/**
 * Decision core for the fixture-matrix gate (#670): whether the run
 * proceeds, and the exact reason when it doesn't. Pure — no I/O.
 */

import { describe, expect, it } from 'vitest';

import { decideFixtureMatrix } from './decide.js';

describe('decideFixtureMatrix', () => {
  it('accepts a fixture name present in availableFixtures', () => {
    expect(
      decideFixtureMatrix({ fixtureArg: 'js-vanilla', availableFixtures: ['js-vanilla', 'rust-vanilla'] }),
    ).toEqual({ ok: true, fixture: 'js-vanilla' });
  });

  it('rejects a missing fixture argument', () => {
    expect(decideFixtureMatrix({ fixtureArg: undefined, availableFixtures: ['js-vanilla'] })).toEqual({
      ok: false,
      reason: 'a fixture name is required (usage: piot-ci fixture-matrix <fixture>)',
    });
  });

  it('rejects an empty-string fixture argument the same as a missing one', () => {
    expect(decideFixtureMatrix({ fixtureArg: '', availableFixtures: ['js-vanilla'] })).toEqual({
      ok: false,
      reason: 'a fixture name is required (usage: piot-ci fixture-matrix <fixture>)',
    });
  });

  it('rejects a fixture name not present in availableFixtures', () => {
    expect(decideFixtureMatrix({ fixtureArg: 'no-such-fixture', availableFixtures: ['js-vanilla'] })).toEqual({
      ok: false,
      reason: "no fixture named 'no-such-fixture' under packages/engine/tests/fixtures",
    });
  });

  it('rejects a name that matches a non-directory entry the caller filtered out upstream', () => {
    expect(decideFixtureMatrix({ fixtureArg: 'README.md', availableFixtures: ['js-vanilla'] })).toEqual({
      ok: false,
      reason: "no fixture named 'README.md' under packages/engine/tests/fixtures",
    });
  });
});
